"""issue sms delivery status

Revision ID: a46c5193de7d
Revises: 42a5ea5a1799
Create Date: 2026-09-28 22:40:52.761039
"""
from alembic import op
import sqlalchemy as sa


revision = 'a46c5193de7d'
down_revision = '42a5ea5a1799'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('issue_updates', sa.Column('sms_status', sa.String(length=12), nullable=True))
    op.add_column('issue_updates', sa.Column('provider_ref', sa.String(length=80), nullable=True))
    op.create_index(op.f('ix_issue_updates_provider_ref'), 'issue_updates', ['provider_ref'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_issue_updates_provider_ref'), table_name='issue_updates')
    op.drop_column('issue_updates', 'provider_ref')
    op.drop_column('issue_updates', 'sms_status')
