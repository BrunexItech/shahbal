"""gis link challenge purpose

Revision ID: f9b3b61f846b
Revises: b4c445b1ef17
Create Date: 2026-09-24 16:49:07.482099
"""
from alembic import op
import sqlalchemy as sa


revision = 'f9b3b61f846b'
down_revision = 'b4c445b1ef17'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE challenge_purpose ADD VALUE IF NOT EXISTS 'gis_link'")


def downgrade() -> None:
    # Postgres can't drop a single enum value; unused 'gis_link' rows are harmless.
    op.execute("DELETE FROM auth_challenges WHERE purpose = 'gis_link'")
