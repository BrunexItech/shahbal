from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog


def record(
    session: AsyncSession,
    *,
    actor_id: str | None,
    action: str,
    entity: str,
    entity_id: str | None = None,
    ip: str | None = None,
    **meta,
) -> None:
    """Adds an audit row to the caller's transaction — it commits or rolls back
    together with the change it describes."""
    session.add(AuditLog(actor_id=actor_id, action=action, entity=entity, entity_id=entity_id, ip=ip, meta=meta or None))
