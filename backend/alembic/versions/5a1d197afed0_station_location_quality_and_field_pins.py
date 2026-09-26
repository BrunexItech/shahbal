"""station location quality and field pins

Revision ID: 5a1d197afed0
Revises: 2a80bd1793b2
Create Date: 2026-09-26 14:22:32.871766
"""
from alembic import op
import sqlalchemy as sa


revision = '5a1d197afed0'
down_revision = '2a80bd1793b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('polling_stations', sa.Column('location_quality', sa.String(length=12), nullable=True))
    op.add_column('polling_stations', sa.Column('pin_lat', sa.Float(), nullable=True))
    op.add_column('polling_stations', sa.Column('pin_lng', sa.Float(), nullable=True))
    op.add_column('polling_stations', sa.Column('pin_accuracy', sa.Float(), nullable=True))
    op.add_column('polling_stations', sa.Column('pin_by_id', sa.String(), nullable=True))
    op.add_column('polling_stations', sa.Column('pin_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key('polling_stations_pin_by_id_fkey', 'polling_stations', 'users', ['pin_by_id'], ['id'], ondelete='SET NULL')
    # Pins loaded before this came from the 2013 IEBC list: right area, not the exact building.
    op.execute("UPDATE polling_stations SET location_quality = 'approximate' WHERE latitude IS NOT NULL")


def downgrade() -> None:
    op.drop_constraint('polling_stations_pin_by_id_fkey', 'polling_stations', type_='foreignkey')
    op.drop_column('polling_stations', 'pin_at')
    op.drop_column('polling_stations', 'pin_by_id')
    op.drop_column('polling_stations', 'pin_accuracy')
    op.drop_column('polling_stations', 'pin_lng')
    op.drop_column('polling_stations', 'pin_lat')
    op.drop_column('polling_stations', 'location_quality')
