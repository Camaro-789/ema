"""
Modelos de la CAPA LÓGICA FTTH (topología y conectividad).

IMPORTANTE — diseño no destructivo (ver docs/DISENO_CAPA_LOGICA.md §12):
- Este archivo SOLO crea tablas NUEVAS.
- No modifica `ftth_elementos`, `ftth_tipos`, `ftth_carpetas` ni ninguna tabla existente.
- Ninguna columna de este archivo es obligatoria para el mapa: si no se usa la capa
  lógica, la aplicación funciona exactamente igual que antes.

Contención implementada en este incremento:
    cable (ftth_elementos, categoria='cables')
      └── tubo holgado  -> ftth_cable_tubos
            └── hilo    -> ftth_cable_fibras
                  └── extremo A/B -> ftth_fibra_extremos
"""
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from app.database import Base

# Código de colores TIA-598-C (12 colores, se cicla para tubos > 12)
TIA598_NOMBRES = [
    "Azul", "Naranja", "Verde", "Marrón", "Pizarra", "Blanco",
    "Rojo", "Negro", "Amarillo", "Violeta", "Rosa", "Aguamarina",
]
TIA598_HEX = [
    "#1E90FF", "#FF8C00", "#22C55E", "#8B4513", "#708090", "#F1F5F9",
    "#EF4444", "#111111", "#EAB308", "#A855F7", "#EC4899", "#06B6D4",
]

# Estados válidos de un hilo
ESTADOS_FIBRA = ("libre", "empalmado", "conectado", "reservado", "averiado")


def color_tia598(numero: int) -> tuple:
    """Devuelve (nombre, hex) del color TIA-598 para una posición 1..N (cicla cada 12)."""
    try:
        n = int(numero)
    except (TypeError, ValueError):
        n = 1
    if n < 1:
        n = 1
    idx = (n - 1) % 12
    return TIA598_NOMBRES[idx], TIA598_HEX[idx]


class FtthCableTubo(Base):
    """Tubo holgado (loose tube) dentro de un cable."""

    __tablename__ = "ftth_cable_tubos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tubo_no = Column(Integer, nullable=False)              # 1..n
    color = Column(String(20), nullable=True)              # nombre TIA-598
    color_hex = Column(String(9), nullable=True)           # hex para la UI
    capacidad_fibras = Column(Integer, nullable=True, default=12)
    etiqueta = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("elemento_id", "tubo_no", name="uq_ftth_cable_tubo_no"),
    )


class FtthCableFibra(Base):
    """Hilo (fibra individual) dentro de un tubo de un cable."""

    __tablename__ = "ftth_cable_fibras"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tubo_id = Column(
        Integer, ForeignKey("ftth_cable_tubos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hilo_no_en_tubo = Column(Integer, nullable=False)      # 1..fibras por loose
    hilo_global_no = Column(Integer, nullable=False)       # 1..total de hilos del cable
    color = Column(String(20), nullable=True)              # nombre TIA-598
    color_hex = Column(String(9), nullable=True)
    estado = Column(String(20), nullable=False, default="libre", index=True)
    perfil = Column(String(30), nullable=True)             # G.652D, G.657A2...

    __table_args__ = (
        UniqueConstraint("tubo_id", "hilo_no_en_tubo", name="uq_ftth_fibra_en_tubo"),
        UniqueConstraint("elemento_id", "hilo_global_no", name="uq_ftth_fibra_global"),
        Index("ix_ftth_fibra_proyecto_estado", "proyecto_id", "estado"),
    )


class FtthFibraExtremo(Base):
    """
    Extremo (A / B) de un hilo: dónde termina físicamente.

    Los extremos son los puntos donde vive la conectividad (empalmes y conexiones
    de fases posteriores). Es el ancla que permite recorrer el camino lógico
    sin depender de la geometría.

    Nota: `tramo_id` y `bandeja_id` se incorporarán (ALTER TABLE ADD COLUMN, aditivo)
    cuando existan las tablas `ftth_cable_tramos` (F2.5) y `ftth_bandejas` (F3).
    """

    __tablename__ = "ftth_fibra_extremos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fibra_id = Column(
        Integer, ForeignKey("ftth_cable_fibras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    extremo = Column(String(1), nullable=False)            # 'A' o 'B'
    nodo_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="SET NULL"), nullable=True, index=True
    )
    holgura_m = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("fibra_id", "extremo", name="uq_ftth_fibra_extremo"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# F3 — Interior del nodo: bandejas, dispositivos y puertos
# ─────────────────────────────────────────────────────────────────────────────

class FtthBandeja(Base):
    """Bandeja de empalme dentro de un nodo (caja, manga, ODF, armario)."""

    __tablename__ = "ftth_bandejas"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bandeja_no = Column(Integer, nullable=False)
    tipo = Column(String(20), nullable=False, default="empalme")   # empalme|paso|splitter|mixta
    slots = Column(Integer, nullable=True, default=12)
    etiqueta = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("elemento_id", "bandeja_no", name="uq_ftth_bandeja_no"),
    )


class FtthDispositivo(Base):
    """
    Aparato instalado dentro de un nodo: splitter, adaptador, WDM, pigtail, switch.

    `tipo_id` reutiliza el catálogo de plantillas existente (ftth_tipos) para no
    duplicar la definición del splitter (relacion_division, entradas, salidas).
    """

    __tablename__ = "ftth_dispositivos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bandeja_id = Column(
        Integer, ForeignKey("ftth_bandejas.id", ondelete="SET NULL"), nullable=True
    )
    tipo_id = Column(
        Integer, ForeignKey("ftth_tipos.id", ondelete="SET NULL"), nullable=True
    )
    tipo = Column(String(30), nullable=False, default="splitter")
    serie = Column(String(100), nullable=True)
    division = Column(String(20), nullable=True)        # 1x8, 1x16, 2x16...
    puertos_in = Column(Integer, nullable=True, default=1)
    puertos_out = Column(Integer, nullable=True, default=1)
    atenuacion_db = Column(Float, nullable=True)
    estado = Column(String(20), nullable=False, default="operativo")


class FtthPuerto(Base):
    """Puerto direccionable de un dispositivo (IN / OUT / BIDI)."""

    __tablename__ = "ftth_puertos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dispositivo_id = Column(
        Integer, ForeignKey("ftth_dispositivos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalizado: permite listar los puertos de una caja sin joins
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    direccion = Column(String(4), nullable=False)       # IN | OUT | BIDI
    puerto_no = Column(Integer, nullable=False)
    tipo_conector = Column(String(20), nullable=True)   # SC/APC, SC/UPC, LC/APC...
    estado = Column(String(20), nullable=False, default="libre")
    etiqueta = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("dispositivo_id", "direccion", "puerto_no", name="uq_ftth_puerto"),
        Index("ix_ftth_puerto_elemento_estado", "elemento_id", "estado"),
    )

