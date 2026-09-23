from __future__ import annotations

from datetime import datetime
from typing import AsyncIterator
from uuid import uuid4

from sqlalchemy import DateTime, func
from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.pool import NullPool

from app.core.config import settings

engine = (
    create_async_engine(settings.database_url, poolclass=NullPool)
    if settings.testing
    else create_async_engine(settings.database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


class Base(AsyncAttrs, DeclarativeBase):
    # Every datetime is timestamptz; display/bucketing converts to settings.timezone.
    type_annotation_map = {datetime: DateTime(timezone=True)}

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


def pg_enum(enum_cls, name: str):
    """Postgres ENUM persisted by member *value* (SQLAlchemy defaults to names)."""
    from sqlalchemy import Enum

    return Enum(enum_cls, name=name, values_callable=lambda e: [m.value for m in e])
