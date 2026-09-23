from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.core.deps import Ctx, require
from app.core.pagination import Page
from app.core.roles import ADMINS
from app.modules.audit.models import AuditLog
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    actor_name: str | None
    action: str
    entity: str
    entity_id: str | None
    meta: dict | None
    ip: str | None


@router.get("", response_model=Page[AuditOut])
async def list_audit(
    action: str | None = None,
    actor_id: str | None = None,
    entity_id: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    ctx: Ctx = Depends(require(*ADMINS)),
):
    stmt = select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.actor_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)

    total = (await ctx.session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await ctx.session.execute(stmt.order_by(AuditLog.created_at.desc()).limit(size).offset((page - 1) * size))
    ).all()
    items = [AuditOut(**{**{c: getattr(a, c) for c in ("id", "created_at", "action", "entity", "entity_id", "meta", "ip")},
                         "actor_name": name}) for a, name in rows]
    return Page(items=items, total=total, page=page, size=size)
