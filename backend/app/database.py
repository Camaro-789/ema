"""Configuración de base de datos"""
import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Usar SQLite por defecto si no hay PostgreSQL configurado
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tachira_maps.db")

# Configuración para SQLite
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def asegurar_migraciones(eng):
    """Garantiza que columnas añadidas a los modelos SQLAlchemy existan en bases de datos existentes."""
    try:
        from sqlalchemy import text
        with eng.connect() as conn:
            # Inspeccionar ftth_elementos
            res = conn.execute(text("PRAGMA table_info(ftth_elementos);"))
            cols = {r[1] for r in res.fetchall()}
            if cols:
                if "extremo_A_id" not in cols:
                    conn.execute(text("ALTER TABLE ftth_elementos ADD COLUMN extremo_A_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL;"))
                if "extremo_B_id" not in cols:
                    conn.execute(text("ALTER TABLE ftth_elementos ADD COLUMN extremo_B_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL;"))
                if "reserva_A_m" not in cols:
                    conn.execute(text("ALTER TABLE ftth_elementos ADD COLUMN reserva_A_m FLOAT DEFAULT 0;"))
                if "reserva_B_m" not in cols:
                    conn.execute(text("ALTER TABLE ftth_elementos ADD COLUMN reserva_B_m FLOAT DEFAULT 0;"))
                conn.commit()

            # Inspeccionar ftth_empalmes
            res_emp = conn.execute(text("PRAGMA table_info(ftth_empalmes);"))
            cols_emp = {r[1] for r in res_emp.fetchall()}
            if cols_emp:
                if "puerto_id" not in cols_emp:
                    conn.execute(text("ALTER TABLE ftth_empalmes ADD COLUMN puerto_id INTEGER REFERENCES ftth_puertos(id) ON DELETE SET NULL;"))
                if "propiedades" not in cols_emp:
                    conn.execute(text("ALTER TABLE ftth_empalmes ADD COLUMN propiedades JSON DEFAULT '{}';"))
                if "extremo_a" not in cols_emp:
                    conn.execute(text("ALTER TABLE ftth_empalmes ADD COLUMN extremo_a VARCHAR(10) NOT NULL DEFAULT 'entrada';"))
                if "extremo_b" not in cols_emp:
                    conn.execute(text("ALTER TABLE ftth_empalmes ADD COLUMN extremo_b VARCHAR(10) NOT NULL DEFAULT 'salida';"))
                conn.commit()
    except Exception as e:
        # En transacciones no-commit o motores distintos a SQLite esto no debe abortar
        pass