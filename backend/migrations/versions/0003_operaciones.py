"""Operaciones idempotentes por operation_id

Tabla ADITIVA `ftth_operaciones`: el mismo `operation_id` repetido devuelve el
resultado anterior sin volver a escribir (Fase 2.3).

Revision ID: 0003_operaciones
Revises: 0002_revision
"""
from alembic import op

from app import esquema

revision = "0003_operaciones"
down_revision = "0002_revision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    esquema.paso_operaciones(op.get_bind().engine)


def downgrade() -> None:
    esquema.paso_operaciones_reversa(op.get_bind().engine)
