"""Messaging overview: everything sent, and what happened to it, by day, channel and place.
Scoped by the recipients' area, like every other number in the app."""
from sqlalchemy import case, func, select

from app.core.clock import local_date, local_midnight
from app.core.deps import Ctx
from app.core.scope import voter_scope
from app.modules.geo.models import Constituency, Ward
from app.modules.messaging.models import Message, MessageCampaign, MessageStatus
from app.modules.voters.models import Voter


async def messaging_stats(ctx: Ctx, days: int) -> dict:
    s = ctx.session
    since = local_midnight(days - 1)
    base = (select().select_from(Message).join(Voter, Voter.id == Message.voter_id)
            .join(MessageCampaign, MessageCampaign.id == Message.campaign_id).where(voter_scope(ctx.user)))
    st = Message.status
    counts = (
        func.count().label("total"),
        func.count(case((st.in_((MessageStatus.sent, MessageStatus.delivered)), 1))).label("sent"),
        func.count(case((st == MessageStatus.delivered, 1))).label("delivered"),
        func.count(case((st == MessageStatus.failed, 1))).label("failed"),
        func.count(case((st == MessageStatus.queued, 1))).label("queued"),
    )
    total = (await s.execute(base.add_columns(*counts).where(Message.created_at >= since))).one()
    by_channel = {ch.value: dict(total=t, delivered=d, failed=f) for ch, t, _sent, d, f, _q in (await s.execute(
        base.add_columns(MessageCampaign.channel, *counts).where(Message.created_at >= since).group_by(MessageCampaign.channel))).all()}
    day = local_date(Message.created_at)
    rows = {d: (t, dl, f) for d, t, _sent, dl, f, _q in (await s.execute(
        base.add_columns(day, *counts).where(Message.created_at >= since).group_by(day))).all()}
    series = []
    for i in range(days):
        d = local_midnight(days - 1 - i).date()
        t, dl, f = rows.get(d, (0, 0, 0))
        series.append({"date": d.isoformat(), "total": t, "delivered": dl, "failed": f, "pending": max(t - dl - f, 0)})
    places = (await s.execute(
        base.add_columns(Constituency.name, *counts).join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
        .where(Message.created_at >= since).group_by(Constituency.name).order_by(Constituency.name))).all()
    opted = (await s.execute(select(func.count()).select_from(Voter).where(voter_scope(ctx.user), Voter.opted_out.is_(True)))).scalar_one()
    campaigns = (await s.execute(select(func.count(func.distinct(Message.campaign_id))).select_from(Message)
                                 .join(Voter, Voter.id == Message.voter_id).where(voter_scope(ctx.user), Message.created_at >= since))).scalar_one()
    return {
        "days": days, "campaigns": campaigns, "total": total.total, "sent": total.sent, "delivered": total.delivered,
        "failed": total.failed, "queued": total.queued, "opted_out": opted,
        "delivery_rate": round(total.delivered / total.total * 100, 1) if total.total else None,
        "by_channel": by_channel, "series": series,
        "constituencies": [{"name": n, "total": t, "delivered": d, "failed": f} for n, t, _s, d, f, _q in places],
    }
