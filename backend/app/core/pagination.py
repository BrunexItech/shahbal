from typing import Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int


async def paginate(session: AsyncSession, stmt: Select, page: int, size: int) -> tuple[list, int]:
    total = (await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await session.execute(stmt.limit(size).offset((page - 1) * size))).scalars().all()
    return list(rows), total
