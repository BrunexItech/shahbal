"""Campaign plan: how many people we intend to capture each week until election day,
against what actually happened. Drives "planned by today" on the Command Centre."""
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.core import audit
from app.core.clock import TZ, local_date, utcnow
from app.core.deps import Ctx
from app.core.roles import Role
from app.core.scope import voter_scope
from app.modules.election.models import PlanWeek
from app.modules.election.service import load_settings
from app.modules.geo.models import Ward
from app.modules.voters.models import Status, Voter


class WeekIn(BaseModel):
    week_start: date
    target: int = Field(ge=0, le=1_000_000)


class PlanIn(BaseModel):
    weeks: list[WeekIn] = Field(max_length=120)


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


async def plan_view(ctx: Ctx) -> dict:
    s = ctx.session
    st = await load_settings(s)
    weeks = (await s.execute(select(PlanWeek).order_by(PlanWeek.week_start))).scalars().all()
    today = utcnow().astimezone(TZ).date()
    vs = voter_scope(ctx.user)
    live = Voter.status != Status.rejected
    target_total = (await s.execute(select(func.coalesce(func.sum(Ward.target), 0)))).scalar_one()
    achieved = (await s.execute(select(func.count()).where(vs, live))).scalar_one()
    day = local_date(Voter.created_at)
    first = weeks[0].week_start if weeks else monday(today)
    daily = dict((await s.execute(select(day, func.count()).where(vs, live, day >= first).group_by(day))).all())
    before = (await s.execute(select(func.count()).where(vs, live, day < first))).scalar_one()

    out, cum_t, cum_a, planned_today = [], before, before, before
    for w in weeks:
        end = w.week_start + timedelta(days=7)
        actual = sum(n for d, n in daily.items() if w.week_start <= d < end)
        cum_t += w.target
        if w.week_start <= today:
            cum_a += actual
        if end <= today:
            planned_today += w.target
        elif w.week_start <= today:  # current week, pro rata by days elapsed (today counts)
            planned_today += round(w.target * ((today - w.week_start).days + 1) / 7)
        out.append({"week_start": w.week_start.isoformat(), "target": w.target, "actual": actual if w.week_start <= today else None,
                    "cumulative_target": cum_t, "cumulative_actual": cum_a if w.week_start <= today else None,
                    "current": w.week_start <= today < end, "past": end <= today})
    return {
        "election_date": st.election_date.isoformat() if st.election_date else None,
        "days_left": max((st.election_date - today).days, 0) if st.election_date else None,
        "target_total": target_total, "achieved": achieved, "before_plan": before,
        "planned_total": sum(w.target for w in weeks) + before,
        "planned_by_today": planned_today if weeks else None,
        "vs_plan": achieved - planned_today if weeks else None,
        "weeks": out,
    }


async def save_plan(ctx: Ctx, data: PlanIn) -> dict:
    if ctx.user.role != Role.super_admin:
        raise HTTPException(403, "Only HQ can change the campaign plan")
    starts = [w.week_start for w in data.weeks]
    if any(d.weekday() != 0 for d in starts) or len(set(starts)) != len(starts):
        raise HTTPException(422, "Each week must start on a different Monday")
    await ctx.session.execute(delete(PlanWeek))
    for w in data.weeks:
        ctx.session.add(PlanWeek(week_start=w.week_start, target=w.target))
    audit.record(ctx.session, actor_id=ctx.user.id, action="PLAN_SAVE", entity="plan", entity_id="campaign", ip=ctx.ip,
                 weeks=len(data.weeks), total=sum(w.target for w in data.weeks))
    await ctx.session.commit()
    return await plan_view(ctx)
