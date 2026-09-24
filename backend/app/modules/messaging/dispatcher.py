"""Background delivery. Runs in the worker process (app/worker.py), never in a
request. Every step is safe to run concurrently on several workers:
row locks with SKIP LOCKED + a unique (campaign, voter) key mean no voter is
ever messaged twice by the same campaign."""
import logging
from datetime import datetime

from sqlalchemy import case, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.clock import TZ, utcnow
from app.core.config import settings
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.messaging.models import CampaignStatus, Channel, Message, MessageCampaign, MessageStatus
from app.modules.messaging.providers import OutItem, get_provider
from app.modules.messaging.render import render, voter_context
from app.modules.messaging.service import final_body
from app.modules.users.models import User
from app.modules.voters.audience import Audience, audience_filter
from app.modules.voters.models import Voter

log = logging.getLogger("dispatcher")
BATCH = 200


def in_quiet_hours(now: datetime | None = None) -> bool:
    h = (now or datetime.now(TZ)).astimezone(TZ).hour
    s, e = settings.messaging_quiet_start, settings.messaging_quiet_end
    return h >= s or h < e if s > e else s <= h < e


async def materialize(session: AsyncSession, c: MessageCampaign) -> int:
    """Freeze the audience into Message rows at send time, scoped by the creator's area."""
    creator = await session.get(User, c.created_by_id)
    if creator is None or not creator.is_active:
        c.status = CampaignStatus.cancelled
        return 0
    stmt = (
        select(Voter.id, Voter.phone, Voter.full_name, Ward.name, Constituency.name, PollingStation.name)
        .join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
        .outerjoin(PollingStation, PollingStation.id == Voter.station_id)
        .where(*audience_filter(creator, Audience(**c.audience)))
    )
    text = final_body(c.channel, c.body)
    total = 0
    result = await session.stream(stmt.execution_options(yield_per=1000))
    async for part in result.partitions(1000):
        rows = [{"campaign_id": c.id, "voter_id": vid, "phone": phone, "body": render(text, voter_context(name, w, k, st))}
                for vid, phone, name, w, k, st in part]
        if rows:
            await session.execute(insert(Message).values(rows).on_conflict_do_nothing(constraint="uq_message_campaign_voter"))
            total += len(rows)
    c.recipients = total
    return total


async def refresh_counters(session: AsyncSession, cid: str) -> None:
    sent, delivered, failed, queued = (await session.execute(
        select(
            func.count(case((Message.status.in_([MessageStatus.sent, MessageStatus.delivered]), 1))),
            func.count(case((Message.status == MessageStatus.delivered, 1))),
            func.count(case((Message.status == MessageStatus.failed, 1))),
            func.count(case((Message.status == MessageStatus.queued, 1))),
        ).where(Message.campaign_id == cid)
    )).one()
    values = dict(sent=sent, delivered=delivered, failed=failed)
    if queued == 0:
        values.update(status=CampaignStatus.sent, completed_at=utcnow())
    await session.execute(update(MessageCampaign).where(MessageCampaign.id == cid, MessageCampaign.status == CampaignStatus.sending).values(**values))


async def start_due_campaigns(session: AsyncSession) -> int:
    due = (await session.execute(
        select(MessageCampaign).where(MessageCampaign.status == CampaignStatus.scheduled, MessageCampaign.scheduled_at <= utcnow())
        .with_for_update(skip_locked=True).limit(5)
    )).scalars().all()
    for c in due:
        c.status, c.started_at = CampaignStatus.sending, utcnow()
        n = await materialize(session, c)
        log.info("campaign %s materialised %d recipients", c.id, n)
        if n == 0 and c.status == CampaignStatus.sending:
            c.status, c.completed_at = CampaignStatus.sent, utcnow()
    await session.commit()
    return len(due)


async def send_batch(session: AsyncSession) -> int:
    rows = (await session.execute(
        select(Message, MessageCampaign.channel, Voter.opted_out)
        .join(MessageCampaign, MessageCampaign.id == Message.campaign_id)
        .join(Voter, Voter.id == Message.voter_id)
        .where(Message.status == MessageStatus.queued, MessageCampaign.status == CampaignStatus.sending)
        .order_by(Message.created_at).limit(BATCH).with_for_update(of=Message, skip_locked=True)
    )).all()
    if not rows:
        return 0
    now = utcnow()
    by_channel: dict[Channel, list[Message]] = {}
    for m, channel, opted_out in rows:
        if opted_out:  # opted out after the audience was frozen: honour it
            m.status, m.error = MessageStatus.failed, "Opted out"
            continue
        by_channel.setdefault(channel, []).append(m)
    for channel, msgs in by_channel.items():
        index = {m.id: m for m in msgs}
        for r in await get_provider(channel).send([OutItem(m.id, m.phone, m.body) for m in msgs]):
            m = index[r.message_id]
            m.provider_id, m.cost, m.error = r.provider_id, r.cost, r.error
            m.status = (MessageStatus.delivered if r.delivered else MessageStatus.sent) if r.ok else MessageStatus.failed
            m.sent_at = now if r.ok else None
            m.delivered_at = now if r.delivered else None
    for cid in {m.campaign_id for m, _, _ in rows}:
        await session.flush()
        await refresh_counters(session, cid)
    await session.commit()
    return len(rows)


async def dispatch_once(factory: async_sessionmaker) -> int:
    if in_quiet_hours():
        return 0
    async with factory() as s:
        await start_due_campaigns(s)
    sent = 0
    async with factory() as s:
        sent += await send_batch(s)
    return sent
