"""videos page

Revision ID: 42a5ea5a1799
Revises: de6a9d027464
Create Date: 2026-09-27 18:25:40.424583
"""
from alembic import op
import sqlalchemy as sa


revision = '42a5ea5a1799'
down_revision = 'de6a9d027464'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('videos',
    sa.Column('title', sa.String(length=140), nullable=False),
    sa.Column('description', sa.String(length=600), nullable=True),
    sa.Column('topic', sa.String(length=20), nullable=False),
    sa.Column('media_id', sa.String(), nullable=True),
    sa.Column('youtube_id', sa.String(length=11), nullable=True),
    sa.Column('published', sa.Boolean(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('added_by_id', sa.String(), nullable=True),
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['media_id'], ['site_media.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_videos_created_at'), 'videos', ['created_at'], unique=False)
    op.create_index(op.f('ix_videos_published'), 'videos', ['published'], unique=False)
    op.create_index(op.f('ix_videos_published_at'), 'videos', ['published_at'], unique=False)
    op.create_index(op.f('ix_videos_topic'), 'videos', ['topic'], unique=False)
    op.add_column('site_media', sa.Column('duration', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('site_media', 'duration')
    op.drop_index(op.f('ix_videos_topic'), table_name='videos')
    op.drop_index(op.f('ix_videos_published_at'), table_name='videos')
    op.drop_index(op.f('ix_videos_published'), table_name='videos')
    op.drop_index(op.f('ix_videos_created_at'), table_name='videos')
    op.drop_table('videos')
