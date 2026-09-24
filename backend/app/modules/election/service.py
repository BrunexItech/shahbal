from datetime import datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import case, func, select

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.deps import Ctx
from app.core.roles import CAPTURERS, Role
from app.core.scope import voter_scope, ward_scope
from app.modules.election.models import ElectionSettings
from app.modules.election.schemas import MarkIn, ReminderPlanIn, RosterRow, SettingsIn, SettingsOut, TurnoutOut, TurnoutRow
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.messaging.models import CampaignStatus, Kind, MessageCampaign
from app.modules.messaging.schemas import CampaignIn
from app.modules.messaging.service import create_campaign
from app.modules.voters.audience import Audience
from app.modules.voters.models import Status, Support, Voter
from app.modules.voters.service import VoterService

GOTV_SUPPORT = [Support.supporter, Support.leaning]


def _pct(v: int, t: int) -> float | None:
    return round(v / t * 100, 1) if t else None


async def load_settings(session) -> ElectionSettings:
    s = await session.get(ElectionSettings, "default")
    if s is None:
        s = ElectionSettings(id="default")
        session.add(s)
        await session.flush()
    return s


def settings_out(s: ElectionSettings) -> SettingsOut:
    out = SettingsOut.model_validate(s)
    if s.election_date:
        today = datetime.now(TZ).date()
        out.days_to_go = (s.election_date - today).days
        out.is_election_day = s.election_date == today
    return out


class ElectionService:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.s = ctx.session
        self.user = ctx.user

    async def get_settings(self) -> SettingsOut:
        s = await load_settings(self.s)
        await self.s.commit()
        return settings_out(s)

    async def update_settings(self, data: SettingsIn) -> SettingsOut:
        if self.user.role != Role.super_admin:
            raise HTTPException(403, "Only HQ administrators can change election settings")
        if data.polls_open >= data.polls_close:
            raise HTTPException(422, "Polls must open before they close")
        s = await load_settings(self.s)
        for k, v in data.model_dump().items():
            setattr(s, k, v)
        audit.record(self.s, actor_id=self.user.id, action="UPDATE", entity="election", entity_id="default", ip=self.ctx.ip,
                     **data.model_dump(mode="json"))
        await self.s.commit()
        return settings_out(s)

    async def mark(self, voter_id: str, data: MarkIn) -> dict:
        if self.user.role not in CAPTURERS:
            raise HTTPException(403, "You cannot record turnout")
        v: Voter = (await VoterService(self.ctx)._row(voter_id))[0]
        v.voted_at = utcnow() if data.voted else None
        v.voted_marked_by_id = self.user.id if data.voted else None
        audit.record(self.s, actor_id=self.user.id, action="MARK_VOTED" if data.voted else "UNMARK_VOTED", entity="voter",
                     entity_id=v.id, ip=self.ctx.ip)
        await self.s.commit()
        return {"id": v.id, "voted_at": v.voted_at}

    async def roster(self, station_id: str | None, ward_id: str | None, q: str | None, only_pending: bool) -> list[RosterRow]:
        if not station_id and not ward_id:
            raise HTTPException(422, "Choose a ward or polling station")
        stmt = select(Voter).where(voter_scope(self.user), Voter.status != Status.rejected, Voter.support.in_(GOTV_SUPPORT))
        if station_id:
            stmt = stmt.where(Voter.station_id == station_id)
        if ward_id:
            stmt = stmt.where(Voter.ward_id == ward_id)
        if q:
            stmt = stmt.where(Voter.full_name.ilike(f"%{q.strip()}%") | Voter.reference.ilike(f"{q.strip()}%"))
        if only_pending:
            stmt = stmt.where(Voter.voted_at.is_(None))
        rows = (await self.s.execute(stmt.order_by(Voter.full_name).limit(300))).scalars()
        return [RosterRow(id=v.id, reference=v.reference, full_name=v.full_name, phone=v.phone, support=v.support.value, voted_at=v.voted_at) for v in rows]

    async def turnout(self, ward_id: str | None) -> TurnoutOut:
        base = [voter_scope(self.user), Voter.status != Status.rejected, Voter.support.in_(GOTV_SUPPORT)]
        voted = func.count(case((Voter.voted_at.is_not(None), 1)))
        tot, vt = (await self.s.execute(select(func.count(Voter.id), voted).where(*base))).one()
        ward_rows = (await self.s.execute(
            select(Ward.id, Ward.name, Constituency.name, func.count(Voter.id), voted)
            .join(Constituency, Constituency.id == Ward.constituency_id)
            .outerjoin(Voter, (Voter.ward_id == Ward.id) & base[0] & base[1] & base[2])
            .where(ward_scope(self.user)).group_by(Ward.id, Constituency.name).order_by(Ward.code)
        )).all()
        stations = []
        if ward_id:
            stations = [TurnoutRow(id=i, name=n, parent=None, targets=t, voted=v, percent=_pct(v, t)) for i, n, t, v in (await self.s.execute(
                select(PollingStation.id, PollingStation.name, func.count(Voter.id), voted)
                .outerjoin(Voter, (Voter.station_id == PollingStation.id) & base[0] & base[1] & base[2])
                .where(PollingStation.ward_id == ward_id).group_by(PollingStation.id).order_by(PollingStation.name)
            )).all()]
        last_hour = (await self.s.execute(select(func.count(Voter.id)).where(*base, Voter.voted_at >= utcnow() - timedelta(hours=1)))).scalar_one()
        return TurnoutOut(
            overall=TurnoutRow(id="all", name="All areas", targets=tot, voted=vt, percent=_pct(vt, tot)),
            wards=[TurnoutRow(id=i, name=n, parent=c, targets=t, voted=v, percent=_pct(v, t)) for i, n, c, t, v in ward_rows],
            stations=stations, last_hour=last_hour,
        )

    async def plan_reminders(self, data: ReminderPlanIn) -> list[str]:
        """Creates the standard GOTV sequence. Idempotent: existing GOTV campaigns
        with the same name are left alone."""
        if self.user.role != Role.super_admin:
            raise HTTPException(403, "Only HQ administrators can schedule GOTV reminders")
        st = await load_settings(self.s)
        if not st.election_date:
            raise HTTPException(422, "Set the election date first")
        d = st.election_date
        at = lambda day, hhmm: datetime.combine(day, time.fromisoformat(hhmm), TZ)  # noqa: E731
        base = Audience(support=GOTV_SUPPORT)
        plan = [
            ("GOTV: 3 days to go", at(d - timedelta(days=3), "18:00"), base,
             "Habari {first_name}! Siku 3 zimebaki. Election day is {date}. Please confirm you vote at {station}. Tuko pamoja!"),
            ("GOTV: eve of election", at(d - timedelta(days=1), "18:30"), base,
             "{first_name}, tomorrow is election day! Polls open {open} at {station}. Carry your ID. Every vote counts."),
            ("GOTV: polls are open", at(d, st.polls_open), base,
             "Good morning {first_name}! Polls are now open at {station} until {close}. Go vote early. Asante!"),
            ("GOTV: afternoon push", at(d, "13:00"), base.model_copy(update={"voted": False}),
             "{first_name}, there is still time! Polls at {station} close at {close}. Please go and vote now."),
        ]
        created = []
        existing = set((await self.s.execute(select(MessageCampaign.name).where(MessageCampaign.kind == Kind.gotv,
                                                                                 MessageCampaign.status != CampaignStatus.cancelled))).scalars())
        for name, when, audience, body in plan:
            if name in existing or when < datetime.now(TZ):
                continue
            body = body.replace("{date}", d.strftime("%a %d %b")).replace("{open}", st.polls_open).replace("{close}", st.polls_close)
            c = await create_campaign(self.s, self.user, CampaignIn(name=name, channel=data.channel, body=body, audience=audience,
                                                                    scheduled_at=when), kind=Kind.gotv, ip=self.ctx.ip)
            created.append(c.id)
        await self.s.commit()
        return created
