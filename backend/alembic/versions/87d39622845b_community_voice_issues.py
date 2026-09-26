"""community voice issues

Revision ID: 87d39622845b
Revises: 5a1d197afed0
Create Date: 2026-09-26 16:34:55.543226
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '87d39622845b'
down_revision = '5a1d197afed0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS issue_ref_seq START 1")
    op.create_table('issues',
    sa.Column('reference', sa.String(length=16), nullable=False),
    sa.Column('category', sa.Enum('water', 'roads', 'health', 'education', 'jobs', 'waste', 'security', 'drainage', 'housing', 'transport', 'electricity', 'environment', 'other', name='issue_category'), nullable=False),
    sa.Column('summary', sa.String(length=140), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('ward_id', sa.String(), nullable=False),
    sa.Column('area', sa.String(length=120), nullable=True),
    sa.Column('latitude', sa.Float(), nullable=True),
    sa.Column('longitude', sa.Float(), nullable=True),
    sa.Column('source', sa.Enum('public', 'field', 'call_centre', name='issue_source'), nullable=False),
    sa.Column('status', sa.Enum('new', 'acknowledged', 'in_progress', 'resolved', 'closed', name='issue_status'), nullable=False),
    sa.Column('priority', sa.Enum('normal', 'high', 'urgent', name='issue_priority'), nullable=False),
    sa.Column('assigned_to_id', sa.String(), nullable=True),
    sa.Column('reporter_name', sa.String(length=120), nullable=True),
    sa.Column('reporter_phone', sa.String(length=20), nullable=True),
    sa.Column('contact_ok', sa.Boolean(), nullable=False),
    sa.Column('consent_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reported_by_id', sa.String(), nullable=True),
    sa.Column('voter_id', sa.String(), nullable=True),
    sa.Column('client_ref', sa.String(length=64), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assigned_to_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reported_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['voter_id'], ['voters.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['ward_id'], ['wards.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('client_ref'),
    sa.UniqueConstraint('reference')
    )
    op.create_index(op.f('ix_issues_assigned_to_id'), 'issues', ['assigned_to_id'], unique=False)
    op.create_index(op.f('ix_issues_category'), 'issues', ['category'], unique=False)
    op.create_index(op.f('ix_issues_created_at'), 'issues', ['created_at'], unique=False)
    op.create_index(op.f('ix_issues_reported_by_id'), 'issues', ['reported_by_id'], unique=False)
    op.create_index(op.f('ix_issues_reporter_phone'), 'issues', ['reporter_phone'], unique=False)
    op.create_index(op.f('ix_issues_source'), 'issues', ['source'], unique=False)
    op.create_index(op.f('ix_issues_status'), 'issues', ['status'], unique=False)
    op.create_index(op.f('ix_issues_ward_id'), 'issues', ['ward_id'], unique=False)
    op.create_table('issue_photos',
    sa.Column('issue_id', sa.String(), nullable=False),
    sa.Column('path', sa.String(length=80), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('width', sa.Integer(), nullable=False),
    sa.Column('height', sa.Integer(), nullable=False),
    sa.Column('added_by_id', sa.String(), nullable=True),
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['issue_id'], ['issues.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_issue_photos_created_at'), 'issue_photos', ['created_at'], unique=False)
    op.create_index(op.f('ix_issue_photos_issue_id'), 'issue_photos', ['issue_id'], unique=False)
    op.create_table('issue_updates',
    sa.Column('issue_id', sa.String(), nullable=False),
    sa.Column('author_id', sa.String(), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('status', postgresql.ENUM('new', 'acknowledged', 'in_progress', 'resolved', 'closed', name='issue_status', create_type=False), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('public', sa.Boolean(), nullable=False),
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['issue_id'], ['issues.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_issue_updates_created_at'), 'issue_updates', ['created_at'], unique=False)
    op.create_index(op.f('ix_issue_updates_issue_id'), 'issue_updates', ['issue_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_issue_updates_issue_id'), table_name='issue_updates')
    op.drop_index(op.f('ix_issue_updates_created_at'), table_name='issue_updates')
    op.drop_table('issue_updates')
    op.drop_index(op.f('ix_issue_photos_issue_id'), table_name='issue_photos')
    op.drop_index(op.f('ix_issue_photos_created_at'), table_name='issue_photos')
    op.drop_table('issue_photos')
    op.drop_index(op.f('ix_issues_ward_id'), table_name='issues')
    op.drop_index(op.f('ix_issues_status'), table_name='issues')
    op.drop_index(op.f('ix_issues_source'), table_name='issues')
    op.drop_index(op.f('ix_issues_reporter_phone'), table_name='issues')
    op.drop_index(op.f('ix_issues_reported_by_id'), table_name='issues')
    op.drop_index(op.f('ix_issues_created_at'), table_name='issues')
    op.drop_index(op.f('ix_issues_category'), table_name='issues')
    op.drop_index(op.f('ix_issues_assigned_to_id'), table_name='issues')
    op.drop_table('issues')
    for t in ("issue_status", "issue_priority", "issue_source", "issue_category"):
        op.execute(f"DROP TYPE IF EXISTS {t}")
    op.execute("DROP SEQUENCE IF EXISTS issue_ref_seq")
