"""Migraciones versionadas del esquema — reemplaza `asegurar_migraciones()`.

Reglas que cumple (R2):
  · Solo cambios ADITIVOS: columnas nuevas (nullable o con DEFAULT) y tablas nuevas.
  · Nunca DROP/TRUNCATE sobre datos existentes: las reversas solo quitan objetos
    que la propia migración creó.
  · Cada paso es atómico y queda registrado en `ftth_migraciones`.

Una sola fuente de DDL
----------------------
Los pasos viven AQUÍ y los ejecutan las revisiones de Alembic
(`backend/migrations/versions/0001…0004`), que solo llaman a estas funciones.

Así no hay dos verdades: `alembic upgrade head` es el único camino y el esquema
resultante es el mismo en SQLite y en PostgreSQL.

Uso (desde backend/):
    python -m alembic upgrade head
    python -m alembic downgrade -1
    python -m alembic current
    python scripts/migrar.py estado            (atajo equivalente)
"""
from typing import List

from sqlalchemy import inspect, text



def _es_postgres(engine) -> bool:
    return engine.dialect.name in ("postgresql", "postgres")


def _tablas(engine) -> set:
    return set(inspect(engine).get_table_names())


def _columnas(engine, tabla: str) -> set:
    inspector = inspect(engine)
    if tabla not in inspector.get_table_names():
        return set()
    return {columna["name"] for columna in inspector.get_columns(tabla)}


def _ejecutar(engine, sentencias: List[str]) -> None:
    with engine.begin() as conexion:
        for sentencia in sentencias:
            conexion.execute(text(sentencia))


def agregar_columna(engine, tabla: str, columna: str, ddl: str) -> bool:
    """ADD COLUMN idempotente. Devuelve True si la agregó."""
    if columna in _columnas(engine, tabla):
        return False
    _ejecutar(engine, [f"ALTER TABLE {tabla} ADD COLUMN {ddl}"])
    return True


def quitar_columna(engine, tabla: str, columna: str) -> bool:
    """DROP COLUMN idempotente (solo para columnas que creó una migración)."""
    if columna not in _columnas(engine, tabla):
        return False
    _ejecutar(engine, [f"ALTER TABLE {tabla} DROP COLUMN {columna}"])
    return True


def crear_tabla(engine, tabla: str, ddl: str) -> bool:
    if tabla in _tablas(engine):
        return False
    _ejecutar(engine, [ddl])
    return True


def quitar_tabla(engine, tabla: str) -> bool:
    if tabla not in _tablas(engine):
        return False
    _ejecutar(engine, [f"DROP TABLE {tabla}"])
    return True


def crear_indice(engine, tabla: str, nombre: str, ddl: str) -> bool:
    if tabla not in _tablas(engine):
        return False
    existentes = {indice["name"] for indice in inspect(engine).get_indexes(tabla)}
    if nombre in existentes:
        return False
    _ejecutar(engine, [ddl])
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Pasos versionados (aditivos y reversibles)
# ─────────────────────────────────────────────────────────────────────────────

def _paso_1(engine) -> None:
    """Columnas del cable y del empalme (las que agregaba asegurar_migraciones)."""
    agregar_columna(engine, "ftth_elementos", "extremo_A_id",
                    "extremo_A_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL")
    agregar_columna(engine, "ftth_elementos", "extremo_B_id",
                    "extremo_B_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL")
    agregar_columna(engine, "ftth_elementos", "reserva_A_m", "reserva_A_m FLOAT DEFAULT 0")
    agregar_columna(engine, "ftth_elementos", "reserva_B_m", "reserva_B_m FLOAT DEFAULT 0")
    agregar_columna(engine, "ftth_empalmes", "puerto_id",
                    "puerto_id INTEGER REFERENCES ftth_puertos(id) ON DELETE SET NULL")
    agregar_columna(engine, "ftth_empalmes", "propiedades", "propiedades JSON DEFAULT '{}'")
    agregar_columna(engine, "ftth_empalmes", "extremo_a",
                    "extremo_a VARCHAR(10) NOT NULL DEFAULT 'entrada'")
    agregar_columna(engine, "ftth_empalmes", "extremo_b",
                    "extremo_b VARCHAR(10) NOT NULL DEFAULT 'salida'")


def _paso_1_reversa(engine) -> None:
    """No se revierte (R2): esas columnas están en uso desde el 23/09 y quitarlas
    rompería el esquema y los datos. Queda constancia en el registro."""
    return None


def _paso_2(engine) -> None:
    """Revisión por contenedor (concurrencia optimista)."""
    agregar_columna(engine, "ftth_elementos", "revision", "revision INTEGER NOT NULL DEFAULT 0")


def _paso_2_reversa(engine) -> None:
    quitar_columna(engine, "ftth_elementos", "revision")


def _ddl_tabla(engine, nombre: str, cuerpo: str) -> str:
    """CREATE TABLE con la PK adecuada al motor (SERIAL en PostgreSQL)."""
    pk = ("id SERIAL PRIMARY KEY" if _es_postgres(engine)
          else "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT")
    return f"CREATE TABLE {nombre} ({pk}, {cuerpo})"


def _paso_3(engine) -> None:
    """Operaciones idempotentes por `operation_id` (Fase 2.3)."""
    ddl = _ddl_tabla(
        engine, "ftth_operaciones",
        "operation_id VARCHAR(36) NOT NULL,"
        " contenedor_id INTEGER NULL,"
        " tipo VARCHAR(40) NOT NULL,"
        " resultado TEXT NULL,"
        " creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"
        " CONSTRAINT uq_ftth_operaciones_operation UNIQUE (operation_id),"
        " FOREIGN KEY(contenedor_id) REFERENCES ftth_elementos(id) ON DELETE CASCADE",
    )
    crear_tabla(engine, "ftth_operaciones", ddl)
    crear_indice(engine, "ftth_operaciones", "ix_ftth_operaciones_contenedor",
                 "CREATE INDEX ix_ftth_operaciones_contenedor "
                 "ON ftth_operaciones(contenedor_id)")


def _paso_3_reversa(engine) -> None:
    quitar_tabla(engine, "ftth_operaciones")


def _paso_4(engine) -> None:
    """Origen de señal y potencia TX (Fase 2.5: hoy no se guarda en ningún sitio)."""
    ddl = _ddl_tabla(
        engine, "ftth_conexion_meta",
        "contenedor_id INTEGER NOT NULL,"
        " empalme_id INTEGER NULL,"
        " puerto_id INTEGER NULL,"
        " fibra_extremo_id INTEGER NULL,"
        " origen_tipo VARCHAR(40) NULL,"
        " senal VARCHAR(10) NULL,"
        " tx_dbm DOUBLE PRECISION NULL,"
        " nota VARCHAR(300) NULL,"
        " creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"
        " FOREIGN KEY(contenedor_id) REFERENCES ftth_elementos(id) ON DELETE CASCADE,"
        " FOREIGN KEY(empalme_id) REFERENCES ftth_empalmes(id) ON DELETE CASCADE,"
        " FOREIGN KEY(puerto_id) REFERENCES ftth_puertos(id) ON DELETE SET NULL,"
        " FOREIGN KEY(fibra_extremo_id) REFERENCES ftth_fibra_extremos(id) ON DELETE CASCADE",
    )
    crear_tabla(engine, "ftth_conexion_meta", ddl)
    crear_indice(engine, "ftth_conexion_meta", "ix_ftth_conexion_meta_contenedor",
                 "CREATE INDEX ix_ftth_conexion_meta_contenedor "
                 "ON ftth_conexion_meta(contenedor_id)")
    crear_indice(engine, "ftth_conexion_meta", "uq_ftth_conexion_meta_empalme",
                 "CREATE UNIQUE INDEX uq_ftth_conexion_meta_empalme "
                 "ON ftth_conexion_meta(empalme_id) WHERE empalme_id IS NOT NULL")


def _paso_4_reversa(engine) -> None:
    quitar_tabla(engine, "ftth_conexion_meta")


# ─────────────────────────────────────────────────────────────────────────────
# Nombres públicos que usan las revisiones de Alembic
# (una sola fuente de DDL: las revisiones solo llaman a estas funciones)
# ─────────────────────────────────────────────────────────────────────────────

paso_columnas_cable = _paso_1
paso_columnas_cable_reversa = _paso_1_reversa
paso_revision = _paso_2
paso_revision_reversa = _paso_2_reversa
paso_operaciones = _paso_3
paso_operaciones_reversa = _paso_3_reversa
paso_conexion_meta = _paso_4
paso_conexion_meta_reversa = _paso_4_reversa

