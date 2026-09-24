"""Live layer: a lightweight "pulse" pushed over Server-Sent Events.

Each tick opens its own short DB session (a stream never pins a connection),
re-checks the viewer's session (revocation ends the stream), and sends small
scoped counters. Heavy dashboard queries are refetched by the client only when
the pulse shows something changed."""
from datetime import timedelta

from sqlalchemy import case, func, select

from app.core.clock import local_midnight, utcnow
from app.core.roles import Role
from app.core.scope import voter_scope
from app.modules.audit.models import AuditLog
from app.modules.calls.models import CallLog
from app.modules.live.models import AgentPresence, AgentStatus
from app.modules.messaging.models import Message, MessageStatus
from app.modules.users.models import User, UserSession
from app.modules.voters.models import Status, Voter

COUNTY_WIDE = {Role.super_admin, Role.viewer}
FEED_ACTIONS = ["CREATE", "VERIFY", "REJECT", "CALL", "CHECKIN", "COMPLETE", "MARK_VOTED", "APPROVE", "PASSKEY_ADD", "NEW_DEVICE"]
ONLINE_WINDOW = timedelta(minutes=5)
PRESENCE_STALE = timedelta(seconds=90)


async def pulse(session, user: User) -> dict:
    vs = voter_scope(user)
    today = local_midnight()
    scoped = select(Voter.id).where(vs)
    v = (await session.execute(select(
        func.count(case((Voter.created_at >= today, 1))),
        func.count(case(((Voter.verified_at >= today) & (Voter.status == Status.verified), 1))),
        func.count(case((Voter.voted_at.is_not(None), 1))),
        func.count(case((Voter.voted_at >= utcnow() - timedelta(hours=1), 1))),
        func.count(Voter.id),
    ).where(vs))).one()
    calls = (await session.execute(select(func.count(CallLog.id)).where(CallLog.created_at >= today, CallLog.voter_id.in_(scoped)))).scalar_one()
    msgs = (await session.execute(select(func.count(Message.id)).where(
        Message.sent_at >= today, Message.status.in_([MessageStatus.sent, MessageStatus.delivered]), Message.voter_id.in_(scoped)))).scalar_one()
    online = dict((await session.execute(
        select(UserSession.portal, func.count(func.distinct(UserSession.user_id)))
        .where(UserSession.revoked_at.is_(None), UserSession.last_seen_at >= utcnow() - ONLINE_WINDOW).group_by(UserSession.portal)
    )).all())
    on_call = (await session.execute(select(func.count(AgentPresence.id)).where(
        AgentPresence.status.in_([AgentStatus.on_call, AgentStatus.ringing]), AgentPresence.heartbeat_at >= utcnow() - PRESENCE_STALE))).scalar_one()
    return {"captures_today": v[0], "verified_today": v[1], "voted": v[2], "voted_last_hour": v[3], "total": v[4],
            "calls_today": calls, "messages_today": msgs, "online_field": online.get("field", 0),
            "online_command": online.get("command", 0), "on_call": on_call}


async def feed(session, user: User, since) -> list[dict]:
    """County-wide activity stream (audit rows aren't area-scoped, so HQ only)."""
    if user.role not in COUNTY_WIDE:
        return []
    rows = (await session.execute(
        select(AuditLog.id, AuditLog.created_at, AuditLog.action, AuditLog.entity, AuditLog.meta, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.created_at > since, AuditLog.action.in_(FEED_ACTIONS))
        .order_by(AuditLog.created_at.desc()).limit(20)
    )).all()
    return [{"id": i, "at": at.isoformat(), "action": a, "entity": e, "meta": m, "actor": n or "Public portal"} for i, at, a, e, m, n in rows]


async def call_wall(session) -> list[dict]:
    rows = (await session.execute(
        select(AgentPresence, User.full_name, Voter.full_name, Voter.reference)
        .join(User, User.id == AgentPresence.user_id).outerjoin(Voter, Voter.id == AgentPresence.voter_id)
        .where(AgentPresence.heartbeat_at >= utcnow() - PRESENCE_STALE).order_by(User.full_name)
    )).all()
    return [{"agent_id": p.user_id, "agent": an, "status": p.status.value, "since": p.status_since.isoformat(),
             "voter": vn, "voter_reference": vr, "line": p.line} for p, an, vn, vr in rows]
