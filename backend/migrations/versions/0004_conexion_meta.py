"""Origen de señal y potencia TX (ftth_conexion_meta)

Tabla ADITIVA. Antes no se guardaba el origen ni la potencia en ningún sitio
(ver INTEGRATION_AUDIT_2.md, punto c).

Revision ID: 0004_conexion_meta
Revises: 0003_operaciones
"""
from alembic import op

from app import esquema

revision = "0004_conexion_meta"
down_revision = "0003_operaciones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    esquema.paso_conexion_meta(op.get_bind().engine)


def downgrade() -> None:
    esquema.paso_conexion_meta_reversa(op.get_bind().engine)
