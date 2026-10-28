"""Columnas del cable y del empalme (baseline aditivo de la capa lógica)

Lo que antes hacía `app.database.asegurar_migraciones()` a mano, ahora versionado.
Es idempotente: si las columnas ya existen (base real del 27/10) no hace nada.

Revision ID: 0001_columnas_cable
Revises:
"""
from alembic import op

from app import esquema

revision = "0001_columnas_cable"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    esquema.paso_columnas_cable(op.get_bind().engine)


def downgrade() -> None:
    # No se revierte (R2): columnas en uso desde el 23/09. Queda documentado aquí
    # y en INTEGRATION_AUDIT_2.md (d).
    esquema.paso_columnas_cable_reversa(op.get_bind().engine)
