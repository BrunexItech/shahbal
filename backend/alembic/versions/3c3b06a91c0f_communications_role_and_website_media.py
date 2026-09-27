"""communications role and website media

Revision ID: 3c3b06a91c0f
Revises: 156084007b73
Create Date: 2026-09-27 10:26:06.415612
"""
from alembic import op
import sqlalchemy as sa


revision = '3c3b06a91c0f'
down_revision = '156084007b73'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New role for the website editor (ADD VALUE is safe inside the migration transaction on PG 12+
    # as long as the new value isn't used in the same transaction).
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'communications'")
    op.create_table('site_media',
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('content_type', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('thumb', sa.String(length=80), nullable=True),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('width', sa.Integer(), nullable=True),
    sa.Column('height', sa.Integer(), nullable=True),
    sa.Column('caption', sa.String(length=200), nullable=True),
    sa.Column('uploaded_by_id', sa.String(), nullable=True),
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_site_media_created_at'), 'site_media', ['created_at'], unique=False)
    op.add_column('news_posts', sa.Column('cover_id', sa.String(), nullable=True))
    op.create_foreign_key('news_posts_cover_id_fkey', 'news_posts', 'site_media', ['cover_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('news_posts_cover_id_fkey', 'news_posts', type_='foreignkey')
    op.drop_column('news_posts', 'cover_id')
    op.drop_index(op.f('ix_site_media_created_at'), table_name='site_media')
    op.drop_table('site_media')
    # Postgres can't drop an enum value; 'communications' stays defined but unused.
