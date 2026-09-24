from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.deps import Ctx
from app.core.roles import Role
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.messaging.models import CampaignStatus, Channel, Kind, Message, MessageCampaign
from app.modules.messaging.render import SMS_FOOTER, render, sms_segments, unknown_placeholders, voter_context
from app.modules.messaging.schemas import CampaignIn, CampaignOut, MessageOut, PreviewIn, PreviewOut, ReviewIn
from app.modules.users.models import User
from app.modules.voters.audience import Audience, audience_filter
from app.modules.voters.models import Voter

MESSAGERS = {Role.super_admin, Role.coordinator, Role.ward_coordinator}


def as_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return utcnow()
    if dt.tzinfo is None:  # naive input is campaign-local time
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(timezone.utc)


def final_body(channel: Channel, body: str) -> str:
    return body + SMS_FOOTER if channel == Channel.sms else body


async def count_audience(session, user: User, a: Audience) -> int:
    return (await session.execute(select(func.count(Voter.id)).where(*audience_filter(user, a)))).scalar_one()


async def create_campaign(session, creator: User, data: CampaignIn, *, kind: Kind = Kind.broadcast,
                          visit_id: str | None = None, ip: str | None = None) -> MessageCampaign:
    """Shared by the composer, visit announcements and GOTV schedules."""
    if bad := unknown_placeholders(data.body):
        raise HTTPException(422, f"Unknown placeholder(s): {', '.join('{' + b + '}' for b in bad)}")
    auto = creator.role == Role.super_admin
    c = MessageCampaign(
        name=data.name, channel=data.channel, kind=kind, body=data.body,
        audience=data.audience.model_dump(mode="json"),
        status=CampaignStatus.scheduled if auto else CampaignStatus.pending_approval,
        scheduled_at=as_utc(data.scheduled_at), created_by_id=creator.id,
        reviewed_by_id=creator.id if auto else None, visit_id=visit_id,
    )
    session.add(c)
    await session.flush()
    audit.record(session, actor_id=creator.id, action="CREATE", entity="campaign", entity_id=c.id, ip=ip,
                 kind=kind.value, channel=data.channel.value, status=c.status.value)
    return c


class MessagingService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session
        self.user = ctx.user

    def _guard(self):
        if self.user.role not in MESSAGERS:
            raise HTTPException(403, "You do not have access to messaging")

    async def preview(self, data: PreviewIn) -> PreviewOut:
        self._guard()
        conds = audience_filter(self.user, data.audience)
        n = (await self.s.execute(select(func.count(Voter.id)).where(*conds))).scalar_one()
        row = (await self.s.execute(
            select(Voter.full_name, Ward.name, Constituency.name, PollingStation.name)
            .join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
            .outerjoin(PollingStation, PollingStation.id == Voter.station_id).where(*conds).limit(1)
        )).first()
        text = final_body(data.channel, data.body)
        sample = render(text, voter_context(*row)) if row else None
        measured = sample or text
        return PreviewOut(recipients=n, sample=sample, chars=len(measured),
                          segments=sms_segments(measured) if data.channel == Channel.sms else 1,
                          unknown_placeholders=unknown_placeholders(data.body))

    async def create(self, data: CampaignIn) -> CampaignOut:
        self._guard()
        if await count_audience(self.s, self.user, data.audience) == 0:
            raise HTTPException(422, "This audience has no reachable recipients")
        c = await create_campaign(self.s, self.user, data, ip=self.ctx.ip)
        await self.s.commit()
        return await self.get(c.id)

    def _visible(self):
        if self.user.role == Role.super_admin:
            return MessageCampaign.id.is_not(None)
        return MessageCampaign.created_by_id == self.user.id

    def _query(self):
        cb, rb = aliased(User), aliased(User)
        return (select(MessageCampaign, cb.full_name, rb.full_name)
                .outerjoin(cb, cb.id == MessageCampaign.created_by_id)
                .outerjoin(rb, rb.id == MessageCampaign.reviewed_by_id)
                .where(self._visible()))

    @staticmethod
    def _out(row) -> CampaignOut:
        c, cb, rb = row
        return CampaignOut.model_validate(c).model_copy(update={"created_by_name": cb, "reviewed_by_name": rb})

    async def list_campaigns(self, status: CampaignStatus | None) -> list[CampaignOut]:
        self._guard()
        stmt = self._query().order_by(MessageCampaign.created_at.desc()).limit(200)
        if status:
            stmt = stmt.where(MessageCampaign.status == status)
        return [self._out(r) for r in (await self.s.execute(stmt)).all()]

    async def get(self, cid: str) -> CampaignOut:
        self._guard()
        row = (await self.s.execute(self._query().where(MessageCampaign.id == cid))).first()
        if row is None:
            raise HTTPException(404, "Campaign not found")
        return self._out(row)

    async def _campaign(self, cid: str) -> MessageCampaign:
        await self.get(cid)  # visibility check
        return await self.s.get(MessageCampaign, cid, with_for_update=True)

    async def review(self, cid: str, data: ReviewIn) -> CampaignOut:
        if self.user.role != Role.super_admin:
            raise HTTPException(403, "Only HQ administrators can approve messages")
        c = await self._campaign(cid)
        if c.status != CampaignStatus.pending_approval:
            raise HTTPException(409, "This campaign is not awaiting approval")
        c.status = CampaignStatus.scheduled if data.approve else CampaignStatus.rejected
        c.reviewed_by_id, c.review_note = self.user.id, data.note
        audit.record(self.s, actor_id=self.user.id, action="APPROVE" if data.approve else "REJECT", entity="campaign",
                     entity_id=c.id, ip=self.ctx.ip, note=data.note)
        await self.s.commit()
        return await self.get(cid)

    async def cancel(self, cid: str) -> CampaignOut:
        c = await self._campaign(cid)
        if c.status not in (CampaignStatus.pending_approval, CampaignStatus.scheduled, CampaignStatus.sending):
            raise HTTPException(409, f"A {c.status.value.replace('_', ' ')} campaign can't be cancelled")
        c.status = CampaignStatus.cancelled
        audit.record(self.s, actor_id=self.user.id, action="CANCEL", entity="campaign", entity_id=c.id, ip=self.ctx.ip)
        await self.s.commit()
        return await self.get(cid)

    async def messages(self, cid: str, page: int, size: int) -> tuple[list[MessageOut], int]:
        await self.get(cid)
        base = select(Message, Voter.full_name).join(Voter, Voter.id == Message.voter_id).where(Message.campaign_id == cid)
        total = (await self.s.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
        rows = (await self.s.execute(base.order_by(Message.created_at).limit(size).offset((page - 1) * size))).all()
        return [MessageOut.model_validate(m).model_copy(update={"voter_name": n}) for m, n in rows], total
