from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.deps import Ctx
from app.core.roles import MANAGERS, Role
from app.core.scope import can_touch_ward, ward_scope
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.messaging.models import CampaignStatus, Kind, MessageCampaign
from app.modules.messaging.schemas import CampaignIn
from app.modules.messaging.service import as_utc, count_audience, create_campaign
from app.modules.users.models import User
from app.modules.visits.models import Visit, VisitStatus
from app.modules.visits.schemas import CheckinIn, CompleteIn, VisitIn, VisitOut, VisitUpdate
from app.modules.voters.audience import Audience

DEFAULT_MESSAGE = "Habari {first_name}! Our campaign team will be at {venue} in {ward} on {date} from {time}. Karibu sana!"


def announcement_text(template: str | None, venue: str, when: datetime) -> str:
    local = when.astimezone(TZ)
    return (template or DEFAULT_MESSAGE).replace("{venue}", venue).replace(
        "{date}", local.strftime("%a %d %b")).replace("{time}", local.strftime("%I:%M %p").lstrip("0"))


class VisitService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session
        self.user = ctx.user

    def _query(self):
        lead = aliased(User)
        return (
            select(Visit, Ward.name, Constituency.name, PollingStation.name, lead.full_name,
                   MessageCampaign.status, MessageCampaign.recipients)
            .join(Ward, Ward.id == Visit.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
            .outerjoin(PollingStation, PollingStation.id == Visit.station_id)
            .outerjoin(lead, lead.id == Visit.lead_id)
            .outerjoin(MessageCampaign, MessageCampaign.id == Visit.announcement_campaign_id)
            .where(ward_scope(self.user))
        )

    @staticmethod
    def _out(row) -> VisitOut:
        v, wn, cn, sn, ln, ast, arec = row
        return VisitOut.model_validate(v).model_copy(update=dict(
            ward_name=wn, constituency_name=cn, station_name=sn, lead_name=ln, announcement_status=ast,
            announcement_recipients=arec if ast in (CampaignStatus.sending, CampaignStatus.sent) else None))

    async def list_visits(self, status: VisitStatus | None, ward_id: str | None, frm: datetime | None, to: datetime | None):
        stmt = self._query().order_by(Visit.scheduled_at)
        if status:
            stmt = stmt.where(Visit.status == status)
        if ward_id:
            stmt = stmt.where(Visit.ward_id == ward_id)
        if frm:
            stmt = stmt.where(Visit.scheduled_at >= as_utc(frm))
        if to:
            stmt = stmt.where(Visit.scheduled_at <= as_utc(to))
        return [self._out(r) for r in (await self.s.execute(stmt.limit(500))).all()]

    async def get(self, vid: str) -> VisitOut:
        row = (await self.s.execute(self._query().where(Visit.id == vid))).first()
        if row is None:
            raise HTTPException(404, "Visit not found")
        return self._out(row)

    async def _visit(self, vid: str) -> Visit:
        await self.get(vid)
        return await self.s.get(Visit, vid, with_for_update=True)

    def _manager(self):
        if self.user.role not in MANAGERS:
            raise HTTPException(403, "Only coordinators can plan visits")

    async def create(self, data: VisitIn) -> VisitOut:
        self._manager()
        ward = await self.s.get(Ward, data.ward_id)
        if ward is None or not can_touch_ward(self.user, ward):
            raise HTTPException(403, "You can only plan visits in your area")
        if data.station_id:
            st = await self.s.get(PollingStation, data.station_id)
            if st is None or st.ward_id != ward.id:
                raise HTTPException(422, "Polling station does not belong to this ward")
        when = as_utc(data.scheduled_at)
        if when < utcnow() - timedelta(hours=1):
            raise HTTPException(422, "A visit can't be scheduled in the past")
        v = Visit(**data.model_dump(exclude={"channel", "message", "scheduled_at"}), scheduled_at=when, created_by_id=self.user.id)
        self.s.add(v)
        await self.s.flush()
        if data.announce:
            await self._announce(v, data)
        audit.record(self.s, actor_id=self.user.id, action="CREATE", entity="visit", entity_id=v.id, ip=self.ctx.ip)
        await self.s.commit()
        return await self.get(v.id)

    async def _announce(self, v: Visit, data: VisitIn) -> None:
        audience = Audience(ward_ids=[v.ward_id])
        if await count_audience(self.s, self.user, audience) == 0:
            return  # nobody to tell yet; the visit still stands
        send_at = max(utcnow(), v.scheduled_at - timedelta(hours=v.announce_hours_before))
        c = await create_campaign(self.s, self.user, CampaignIn(
            name=f"Visit: {v.title}"[:120], channel=data.channel,
            body=announcement_text(data.message, v.venue, v.scheduled_at),
            audience=audience, scheduled_at=send_at,
        ), kind=Kind.visit, visit_id=v.id, ip=self.ctx.ip)
        v.announcement_campaign_id = c.id

    async def update(self, vid: str, data: VisitUpdate) -> VisitOut:
        self._manager()
        v = await self._visit(vid)
        if v.status in (VisitStatus.completed, VisitStatus.cancelled):
            raise HTTPException(409, "This visit is closed")
        fields = data.model_dump(exclude_unset=True)
        if "scheduled_at" in fields:
            fields["scheduled_at"] = as_utc(fields["scheduled_at"])
        for k, val in fields.items():
            setattr(v, k, val)
        # Keep an unsent announcement in step with the new time/venue.
        if v.announcement_campaign_id and ({"scheduled_at", "venue"} & fields.keys()):
            c = await self.s.get(MessageCampaign, v.announcement_campaign_id, with_for_update=True)
            if c and c.status in (CampaignStatus.pending_approval, CampaignStatus.scheduled):
                c.scheduled_at = max(utcnow(), v.scheduled_at - timedelta(hours=v.announce_hours_before))
                c.body = announcement_text(None, v.venue, v.scheduled_at)
        audit.record(self.s, actor_id=self.user.id, action="UPDATE", entity="visit", entity_id=v.id, ip=self.ctx.ip, fields=sorted(fields))
        await self.s.commit()
        return await self.get(vid)

    async def cancel(self, vid: str) -> VisitOut:
        self._manager()
        v = await self._visit(vid)
        if v.status in (VisitStatus.completed, VisitStatus.cancelled):
            raise HTTPException(409, "This visit is already closed")
        v.status = VisitStatus.cancelled
        if v.announcement_campaign_id:
            c = await self.s.get(MessageCampaign, v.announcement_campaign_id, with_for_update=True)
            if c and c.status in (CampaignStatus.pending_approval, CampaignStatus.scheduled):
                c.status = CampaignStatus.cancelled
        audit.record(self.s, actor_id=self.user.id, action="CANCEL", entity="visit", entity_id=v.id, ip=self.ctx.ip)
        await self.s.commit()
        return await self.get(vid)

    async def checkin(self, vid: str, data: CheckinIn) -> VisitOut:
        if self.user.role not in MANAGERS | {Role.field_agent}:
            raise HTTPException(403, "You cannot check in to visits")
        v = await self._visit(vid)
        if v.status != VisitStatus.scheduled:
            raise HTTPException(409, "Only a scheduled visit can be started")
        v.status, v.checkin_at, v.checkin_by_id = VisitStatus.in_progress, utcnow(), self.user.id
        v.checkin_lat, v.checkin_lng = data.latitude, data.longitude
        audit.record(self.s, actor_id=self.user.id, action="CHECKIN", entity="visit", entity_id=v.id, ip=self.ctx.ip)
        await self.s.commit()
        return await self.get(vid)

    async def complete(self, vid: str, data: CompleteIn) -> VisitOut:
        if self.user.role not in MANAGERS | {Role.field_agent}:
            raise HTTPException(403, "You cannot close visits")
        v = await self._visit(vid)
        if v.status not in (VisitStatus.scheduled, VisitStatus.in_progress):
            raise HTTPException(409, "This visit is already closed")
        v.status, v.completed_at = VisitStatus.completed, utcnow()
        v.attendance, v.outcome = data.attendance, data.outcome
        audit.record(self.s, actor_id=self.user.id, action="COMPLETE", entity="visit", entity_id=v.id, ip=self.ctx.ip,
                     attendance=data.attendance)
        await self.s.commit()
        return await self.get(vid)
