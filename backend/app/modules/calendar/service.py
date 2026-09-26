"""The campaign calendar: one timeline built from everything that has a date.

Sources: HQ calendar entries, field visits/events, the weekly capture plan, election
day and (for HQ administrators) scheduled SMS/WhatsApp blasts. Area rules match the
rest of the platform; strategy entries marked `hq_only` are for HQ administrators only."""
import uuid
from datetime import datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import ColumnElement, and_, false, or_, select, true

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.deps import Ctx
from app.core.roles import Role
from app.modules.calendar.models import CalendarEvent
from app.modules.calendar.schemas import Entry, EventIn, EventPatch, Gap
from app.modules.election.models import ElectionSettings, PlanWeek
from app.modules.geo.models import Constituency, Ward
from app.modules.mapping.service import MapService
from app.modules.messaging.models import CampaignStatus, MessageCampaign
from app.modules.messaging.service import as_utc
from app.modules.visits.models import Visit, VisitStatus
from app.modules.visits.service import VisitService

MAX_RANGE = timedelta(days=100)


class CalendarService:
    def __init__(self, ctx: Ctx):
        self.ctx, self.s, self.user = ctx, ctx.session, ctx.user

    async def _my_constituency(self) -> str | None:
        if self.user.role == Role.coordinator:
            return self.user.constituency_id
        if self.user.role == Role.ward_coordinator and self.user.ward_id:
            ward = await self.s.get(Ward, self.user.ward_id)
            return ward.constituency_id if ward else None
        return None

    async def _scope(self) -> ColumnElement[bool]:
        """Which HQ entries this person sees: county-wide ones, plus their own area."""
        if self.user.role == Role.super_admin:
            return true()
        visible = CalendarEvent.hq_only.is_(False)
        if self.user.role == Role.viewer:
            return visible
        cons = await self._my_constituency()
        county_wide = and_(CalendarEvent.constituency_id.is_(None), CalendarEvent.ward_id.is_(None))
        if self.user.role == Role.coordinator:
            return and_(visible, or_(county_wide, CalendarEvent.constituency_id == cons))
        if self.user.role == Role.ward_coordinator:
            return and_(visible, or_(county_wide, and_(CalendarEvent.constituency_id == cons, CalendarEvent.ward_id.is_(None)),
                                     CalendarEvent.ward_id == self.user.ward_id))
        return false()

    async def _can_edit(self, e: CalendarEvent) -> bool:
        if self.user.role == Role.super_admin:
            return True
        if e.hq_only or self.user.role not in (Role.coordinator, Role.ward_coordinator):
            return False
        if self.user.role == Role.coordinator:
            return e.constituency_id is not None and e.constituency_id == self.user.constituency_id
        return e.ward_id is not None and e.ward_id == self.user.ward_id

    # ---- reading ----------------------------------------------------------------
    async def entries(self, start: datetime, end: datetime) -> list[Entry]:
        start, end = as_utc(start), as_utc(end)
        if end <= start or end - start > MAX_RANGE:
            raise HTTPException(422, "Choose a range of up to 100 days")
        out: list[Entry] = []

        # HQ entries
        rows = (await self.s.execute(
            select(CalendarEvent, Ward.name, Constituency.name)
            .outerjoin(Ward, Ward.id == CalendarEvent.ward_id)
            .outerjoin(Constituency, Constituency.id == CalendarEvent.constituency_id)
            .where(await self._scope(), CalendarEvent.starts_at < end,
                   or_(CalendarEvent.ends_at >= start, and_(CalendarEvent.ends_at.is_(None), CalendarEvent.starts_at >= start - timedelta(days=1))))
            .order_by(CalendarEvent.starts_at)
        )).all()
        for e, wn, cn in rows:
            out.append(Entry(id=e.id, source="event", kind=e.kind, title=e.title, starts_at=e.starts_at, ends_at=e.ends_at, all_day=e.all_day,
                             status=e.status, ward_id=e.ward_id, ward=wn, constituency_id=e.constituency_id, constituency=cn,
                             location=e.location, notes=e.notes, hq_only=e.hq_only, series_id=e.series_id, can_edit=await self._can_edit(e)))

        # Field visits and events (area rules come with VisitService)
        visits = VisitService(self.ctx)
        for v in await visits.list_visits(None, None, start, end):
            out.append(Entry(id=v.id, source="visit", kind=v.kind, title=v.title, starts_at=v.scheduled_at, ends_at=v.ends_at,
                             status=v.status.value, ward_id=v.ward_id, ward=v.ward_name, constituency=v.constituency_name,
                             location=v.venue, notes=v.notes, lead=v.lead_name, expected_attendance=v.expected_attendance,
                             attendance=v.attendance))

        # The weekly capture plan, as week-long banners
        weeks = (await self.s.execute(
            select(PlanWeek).where(PlanWeek.week_start >= (start - timedelta(days=7)).astimezone(TZ).date(),
                                   PlanWeek.week_start <= end.astimezone(TZ).date(), PlanWeek.target > 0)
        )).scalars().all()
        for w in weeks:
            begin = datetime.combine(w.week_start, time(), TZ)
            out.append(Entry(id=f"plan-{w.week_start.isoformat()}", source="plan", kind="target", title=f"Capture target: {w.target:,}",
                             starts_at=begin, ends_at=begin + timedelta(days=7), all_day=True, target=w.target))

        # Election day
        settings = await self.s.get(ElectionSettings, "default")
        if settings and settings.election_date:
            day = datetime.combine(settings.election_date, time(), TZ)
            if start <= day < end:
                out.append(Entry(id="election", source="election", kind="election", title="Election day", starts_at=day,
                                 ends_at=day + timedelta(days=1), all_day=True))

        # Message blasts (HQ administrators only)
        if self.user.role == Role.super_admin:
            blasts = (await self.s.execute(
                select(MessageCampaign).where(MessageCampaign.scheduled_at >= start, MessageCampaign.scheduled_at < end,
                                              MessageCampaign.status.not_in([CampaignStatus.cancelled, CampaignStatus.rejected]))
            )).scalars().all()
            for c in blasts:
                out.append(Entry(id=f"sms-{c.id}", source="sms", kind=c.channel.value, title=c.name, starts_at=c.scheduled_at,
                                 status=c.status.value, target=c.recipients or None))
        out.sort(key=lambda e: (e.starts_at, not e.all_day))
        return out

    async def gaps(self, days: int) -> list[Gap]:
        """Wards with nothing planned in the next `days`: where the team should go next."""
        until = utcnow() + timedelta(days=days)
        planned = set((await self.s.execute(
            select(Visit.ward_id).where(Visit.status.in_([VisitStatus.scheduled, VisitStatus.in_progress]),
                                        Visit.scheduled_at >= utcnow() - timedelta(hours=2), Visit.scheduled_at <= until)
        )).scalars())
        stats = await MapService(self.ctx).ward_stats()
        gaps = [Gap(ward_id=w["id"], ward=w["name"], constituency=w["constituency"],
                    last_visit_at=datetime.fromisoformat(w["last_visit_at"]) if w["last_visit_at"] else None, percent=w["percent"])
                for w in stats if w["id"] not in planned]
        # Furthest behind first: no target progress and longest since a visit.
        return sorted(gaps, key=lambda g: (g.percent if g.percent is not None else -1, g.last_visit_at or datetime.min.replace(tzinfo=TZ)))

    # ---- writing ----------------------------------------------------------------
    async def _area(self, data: EventIn) -> tuple[str | None, str | None]:
        cons, ward_id = data.constituency_id, data.ward_id
        if ward_id:
            ward = await self.s.get(Ward, ward_id)
            if ward is None:
                raise HTTPException(422, "Unknown ward")
            cons = ward.constituency_id
        elif cons and await self.s.get(Constituency, cons) is None:
            raise HTTPException(422, "Unknown constituency")
        if self.user.role == Role.super_admin:
            return cons, ward_id
        if data.hq_only:
            raise HTTPException(403, "Only HQ administrators can add HQ-only entries")
        if self.user.role == Role.coordinator and cons == self.user.constituency_id:
            return cons, ward_id
        if self.user.role == Role.ward_coordinator and ward_id == self.user.ward_id:
            return cons, ward_id
        raise HTTPException(403, "You can add entries for your own area only")

    async def create(self, data: EventIn) -> list[Entry]:
        cons, ward_id = await self._area(data)
        series = str(uuid.uuid4()) if data.repeat_weeks else None
        start, end = as_utc(data.starts_at), as_utc(data.ends_at) if data.ends_at else None
        made = []
        for i in range(data.repeat_weeks + 1):
            shift = timedelta(weeks=i)
            e = CalendarEvent(title=data.title, kind=data.kind, starts_at=start + shift, ends_at=end + shift if end else None,
                              all_day=data.all_day, constituency_id=cons, ward_id=ward_id, location=data.location, notes=data.notes,
                              hq_only=data.hq_only, series_id=series, created_by_id=self.user.id)
            self.s.add(e)
            made.append(e)
        await self.s.flush()
        audit.record(self.s, actor_id=self.user.id, action="CREATE", entity="calendar", entity_id=made[0].id, ip=self.ctx.ip,
                     kind=data.kind, repeats=data.repeat_weeks)
        await self.s.commit()
        return [Entry(id=e.id, source="event", kind=e.kind, title=e.title, starts_at=e.starts_at, ends_at=e.ends_at, all_day=e.all_day,
                      status=e.status, ward_id=e.ward_id, constituency_id=e.constituency_id, location=e.location, notes=e.notes,
                      hq_only=e.hq_only, series_id=e.series_id, can_edit=True) for e in made]

    async def _editable(self, event_id: str) -> CalendarEvent:
        e = (await self.s.execute(select(CalendarEvent).where(CalendarEvent.id == event_id, await self._scope()))).scalar_one_or_none()
        if e is None:
            raise HTTPException(404, "Entry not found")
        if not await self._can_edit(e):
            raise HTTPException(403, "You can't change this entry")
        return e

    async def update(self, event_id: str, data: EventPatch) -> None:
        e = await self._editable(event_id)
        fields = data.model_dump(exclude_unset=True)
        for k in ("starts_at", "ends_at"):
            if fields.get(k):
                fields[k] = as_utc(fields[k])
        for k, v in fields.items():
            setattr(e, k, v)
        if e.ends_at and e.ends_at <= e.starts_at:
            raise HTTPException(422, "The end must be after the start")
        audit.record(self.s, actor_id=self.user.id, action="UPDATE", entity="calendar", entity_id=e.id, ip=self.ctx.ip, fields=sorted(fields))
        await self.s.commit()

    async def delete(self, event_id: str, series: bool) -> int:
        e = await self._editable(event_id)
        doomed = [e]
        if series and e.series_id:
            # This one and every later repeat; past ones stay as a record.
            doomed = list((await self.s.execute(
                select(CalendarEvent).where(CalendarEvent.series_id == e.series_id, CalendarEvent.starts_at >= e.starts_at)
            )).scalars())
        for d in doomed:
            await self.s.delete(d)
        audit.record(self.s, actor_id=self.user.id, action="DELETE", entity="calendar", entity_id=e.id, ip=self.ctx.ip, count=len(doomed))
        await self.s.commit()
        return len(doomed)

