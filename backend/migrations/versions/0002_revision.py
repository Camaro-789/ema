"""Revisión por contenedor (concurrencia optimista)

`ftth_elementos.revision` es ADITIVA (NOT NULL DEFAULT 0). Sube en cada escritura
del módulo nativo; el cliente manda `base_revision` y recibe 409 si no coincide.

Revision ID: 0002_revision
Revises: 0001_columnas_cable
"""
from alembic import op

from app import esquema

revision = "0002_revision"
down_revision = "0001_columnas_cable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    esquema.paso_revision(op.get_bind().engine)


def downgrade() -> None:
    esquema.paso_revision_reversa(op.get_bind().engine)
