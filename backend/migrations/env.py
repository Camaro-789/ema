"""Entorno de Alembic para Map OLT.

- La URL sale de `DATABASE_URL` (mismo criterio que `app/database.py`), así el
  mismo `alembic upgrade head` sirve para SQLite (desarrollo) y PostgreSQL.
- `target_metadata` es el de los modelos reales: permite `alembic revision
  --autogenerate` en el futuro sin configurar nada más.
- El DDL no se escribe en las revisiones: cada revisión llama a las funciones de
  `app/esquema.py` (una sola fuente de verdad del esquema).
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from app.database import Base  # noqa: E402
import app.models.spatial  # noqa: F401,E402
import app.models.ftth_models  # noqa: F401,E402
import app.models.ftth_logica  # noqa: F401,E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def url_de_entorno() -> str:
    return os.environ.get("DATABASE_URL") or "sqlite:///./tachira_maps.db"


def run_migrations_offline() -> None:
    context.configure(
        url=url_de_entorno(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(url_de_entorno())
    with engine.connect() as conexion:
        context.configure(
            connection=conexion,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
