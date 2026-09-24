"""War-room aggregates. Everything is computed in SQL and scoped to the caller's
area, so the same endpoint powers the county HQ screen and a ward coordinator's phone.

Definitions (shown in the UI too):
  achieved = records in the area that are not rejected
  gap      = max(target - achieved, 0)
"""
import math
from sqlalchemy import case, func, select

from datetime import timedelta

from app.core.clock import local_date, local_midnight, utcnow
from app.core.roles import Role
from app.modules.calls.models import CallLog, Outcome
from app.modules.messaging.models import CampaignStatus, Message, MessageCampaign, MessageStatus
from app.modules.visits.models import Visit, VisitStatus
from app.core.deps import Ctx
from app.core.scope import voter_scope, ward_scope
from app.modules.geo.models import Constituency, Ward
from app.modules.users.models import User
from app.modules.voters.models import Status, Voter


def _counts():
    live = Voter.status != Status.rejected
    return (
        func.count(case((live, 1))).label("achieved"),
        func.count(case((Voter.status == Status.verified, 1))).label("verified"),
        func.count(case((Voter.status == Status.pending, 1))).label("pending"),
    )


def _progress(target: int, achieved: int) -> dict:
    return {
        "target": target,
        "achieved": achieved,
        "gap": max(target - achieved, 0),
        "percent": round(achieved / target * 100, 1) if target else None,
    }


class DashboardService:
    def __init__(self, ctx: Ctx):
        self.s = ctx.session
        self.user = ctx.user

    async def summary(self) -> dict:
        vs, ws = voter_scope(self.user), ward_scope(self.user)
        today = local_midnight()

        totals = (
            await self.s.execute(
                select(
                    func.count().label("total"),
                    *_counts(),
                    func.count(case((Voter.status == Status.rejected, 1))).label("rejected"),
                    func.count(case((Voter.created_at >= today, 1))).label("today"),
                    func.count(case((Voter.opted_out.is_(True), 1))).label("opted_out"),
                ).where(vs)
            )
        ).one()

        # Per-ward progress (outer join so untouched wards still show their full gap).
        ward_rows = (
            await self.s.execute(
                select(Ward.id, Ward.name, Ward.target, Ward.registered_voters, Constituency.id.label("cid"),
                       Constituency.name.label("constituency"), *_counts())
                .join(Constituency, Constituency.id == Ward.constituency_id)
                .outerjoin(Voter, (Voter.ward_id == Ward.id) & vs)
                .where(ws)
                .group_by(Ward.id, Constituency.id)
                .order_by(Constituency.code, Ward.code)
            )
        ).all()
        wards, cons = [], {}
        for r in ward_rows:
            wards.append({"id": r.id, "name": r.name, "constituency_id": r.cid, "constituency": r.constituency,
                          "registered_voters": r.registered_voters, "verified": r.verified, "pending": r.pending,
                          **_progress(r.target, r.achieved)})
            c = cons.setdefault(r.cid, {"id": r.cid, "name": r.constituency, "target": 0, "achieved": 0, "verified": 0})
            c["target"] += r.target
            c["achieved"] += r.achieved
            c["verified"] += r.verified
        constituencies = [{**c, **_progress(c["target"], c["achieved"])} for c in cons.values()]
        target_total = sum(w["target"] for w in wards)

        def breakdown(col):
            return select(col, func.count()).where(vs).group_by(col)

        by_support = {k.value: n for k, n in (await self.s.execute(breakdown(Voter.support))).all()}
        by_source = {k.value: n for k, n in (await self.s.execute(breakdown(Voter.source))).all()}

        since = local_midnight(13)
        day = local_date(Voter.created_at)
        daily_rows = dict(
            (await self.s.execute(select(day, func.count()).where(vs, Voter.created_at >= since).group_by(day))).all()
        )
        daily = [
            {"date": d.isoformat(), "count": daily_rows.get(d, 0)}
            for d in (local_midnight(13 - i).date() for i in range(14))
        ]

        top_agents = [
            {"id": uid, "name": name, "count": n}
            for uid, name, n in (
                await self.s.execute(
                    select(User.id, User.full_name, func.count(Voter.id).label("n"))
                    .join(Voter, Voter.captured_by_id == User.id)
                    .where(vs, Voter.created_at >= local_midnight(6))
                    .group_by(User.id)
                    .order_by(func.count(Voter.id).desc())
                    .limit(5)
                )
            ).all()
        ]

        recent = [
            {"id": v.id, "reference": v.reference, "full_name": v.full_name, "ward": wname, "status": v.status.value,
             "source": v.source.value, "created_at": v.created_at.isoformat()}
            for v, wname in (
                await self.s.execute(
                    select(Voter, Ward.name).join(Ward, Ward.id == Voter.ward_id).where(vs)
                    .order_by(Voter.created_at.desc()).limit(8)
                )
            ).all()
        ]

        ops = await self._ops(vs, today)

        result = {
            "ops": ops,
            "totals": {"total": totals.total, "achieved": totals.achieved, "verified": totals.verified,
                       "pending": totals.pending, "rejected": totals.rejected, "today": totals.today,
                       "opted_out": totals.opted_out},
            "overall": _progress(target_total, totals.achieved),
            "constituencies": constituencies,
            "wards": wards,
            "by_support": by_support,
            "by_source": by_source,
            "daily": daily,
            "top_agents": top_agents,
            "recent": recent,
        }
        result["insights"] = await insights(self.s, self.user, result)
        return result

    async def _ops(self, vs, today) -> dict:
        ws = ward_scope(self.user)
        scoped_wards = select(Ward.id).where(ws)
        in_scope_voters = select(Voter.id).where(vs)
        msgs = (await self.s.execute(
            select(func.count(case((Message.status.in_([MessageStatus.sent, MessageStatus.delivered]), 1))),
                   func.count(case((Message.status == MessageStatus.delivered, 1))))
            .where(Message.sent_at >= today, Message.voter_id.in_(in_scope_voters))
        )).one()
        calls = (await self.s.execute(
            select(func.count(CallLog.id), func.count(case((CallLog.outcome == Outcome.answered, 1))))
            .where(CallLog.created_at >= today, CallLog.voter_id.in_(in_scope_voters))
        )).one()
        visits = (await self.s.execute(
            select(func.count(case(((Visit.scheduled_at >= today) & (Visit.scheduled_at < today + timedelta(days=1)) & (Visit.status != VisitStatus.cancelled), 1))),
                   func.count(case(((Visit.status == VisitStatus.scheduled) & (Visit.scheduled_at >= utcnow()), 1))),
                   func.count(func.distinct(case((Visit.status == VisitStatus.completed, Visit.ward_id)))))
            .where(Visit.ward_id.in_(scoped_wards))
        )).one()
        pending = 0
        if self.user.role == Role.super_admin:
            pending = (await self.s.execute(select(func.count(MessageCampaign.id)).where(MessageCampaign.status == CampaignStatus.pending_approval))).scalar_one()
        voted = (await self.s.execute(select(func.count(Voter.id)).where(vs, Voter.voted_at.is_not(None)))).scalar_one()
        return {"messages_today": msgs[0], "delivered_today": msgs[1], "calls_today": calls[0], "answered_today": calls[1],
                "visits_today": visits[0], "visits_upcoming": visits[1], "wards_visited": visits[2],
                "approvals_pending": pending, "voted": voted}


# ---- insight layer: turns counts into direction, pace and plain-language advice ----
def _status(projected_pct: float | None) -> str:
    if projected_pct is None:
        return "unknown"
    return "on_track" if projected_pct >= 100 else "at_risk" if projected_pct >= 75 else "critical"


async def insights(session, user, summary: dict) -> dict:
    from app.core.clock import TZ, local_date
    from app.modules.election.service import load_settings

    vs = voter_scope(user)
    live = Voter.status != Status.rejected
    today = local_midnight()
    now = utcnow()

    def window(start, end):
        return select(func.count(Voter.id)).where(vs, live, Voter.created_at >= start, Voter.created_at < end)

    same_time_yesterday = now - timedelta(days=1)
    today_n = (await session.execute(window(today, now))).scalar_one()
    yday_to_now = (await session.execute(window(local_midnight(1), same_time_yesterday))).scalar_one()
    last7 = (await session.execute(window(local_midnight(6), now))).scalar_one()
    prev7 = (await session.execute(window(local_midnight(13), local_midnight(6)))).scalar_one()
    pace = round(last7 / 7, 1)

    hour = func.extract("hour", func.timezone("Africa/Nairobi", Voter.created_at))
    hourly_rows = dict((await session.execute(
        select(hour, func.count(Voter.id)).where(vs, live, Voter.created_at >= today).group_by(hour))).all())
    hourly = [int(hourly_rows.get(h, 0)) for h in range(24)]

    st = await load_settings(session)
    days_left = None
    if st.election_date:
        days_left = max((st.election_date - now.astimezone(TZ).date()).days, 0)

    overall = summary["overall"]
    projected = overall["achieved"] + pace * days_left if days_left is not None else None
    required = math.ceil(overall["gap"] / days_left) if days_left else None

    # Per-constituency pace (last 7 days) → projection and a traffic light.
    cons_pace = dict((await session.execute(
        select(Ward.constituency_id, func.count(Voter.id)).join(Ward, Ward.id == Voter.ward_id)
        .where(vs, live, Voter.created_at >= local_midnight(6)).group_by(Ward.constituency_id))).all())
    cons_today = dict((await session.execute(
        select(Ward.constituency_id, func.count(Voter.id)).join(Ward, Ward.id == Voter.ward_id)
        .where(vs, live, Voter.created_at >= today).group_by(Ward.constituency_id))).all())
    constituencies = []
    for c in summary["constituencies"]:
        p = cons_pace.get(c["id"], 0) / 7
        proj = c["achieved"] + p * days_left if days_left is not None else None
        pct = (proj / c["target"] * 100) if (proj is not None and c["target"]) else (c["percent"] if days_left is None else None)
        constituencies.append({**c, "pace": round(p, 1), "today": cons_today.get(c["id"], 0),
                               "projected": round(proj) if proj is not None else None,
                               "projected_percent": round(pct, 1) if pct is not None else None,
                               "status": _status(pct if days_left is not None else (c["percent"] or 0) * 1.33 if c["target"] else None)})

    verified_week = (await session.execute(select(func.count(Voter.id)).where(
        vs, Voter.status == Status.verified, Voter.verified_at >= local_midnight(6)))).scalar_one()
    backlog_days = round(summary["totals"]["pending"] / (verified_week / 7), 1) if verified_week else None

    # Plain-language cards, most important first.
    cards: list[dict] = []
    if days_left is not None and overall["target"]:
        if projected >= overall["target"]:
            cards.append({"tone": "good", "title": "On course to hit the county target",
                          "detail": f"At {round(pace):,}/day we reach about {round(projected):,} by election day, above the {overall['target']:,} target."})
        else:
            cards.append({"tone": "bad", "title": f"Need {required:,} supporters a day to hit target",
                          "detail": f"Current pace is {round(pace):,}/day. At this rate we reach about {round(projected):,} of {overall['target']:,} with {days_left} days left."})
    elif overall["target"]:
        cards.append({"tone": "info", "title": f"{overall['percent'] or 0:g}% of the county target reached",
                      "detail": "Set the election date in Election Day to get projections and a required daily pace."})
    if yday_to_now or today_n:
        diff = today_n - yday_to_now
        cards.append({"tone": "good" if diff >= 0 else "warn",
                      "title": f"{today_n:,} captured today, {'+' if diff >= 0 else ''}{diff:,} vs this time yesterday",
                      "detail": f"This week {last7:,} vs {prev7:,} the week before ({'up' if last7 >= prev7 else 'down'} {abs(last7 - prev7):,})."})
    ranked = [c for c in constituencies if c["target"]]
    if ranked:
        worst = min(ranked, key=lambda c: c["projected_percent"] if c["projected_percent"] is not None else c["percent"] or 0)
        best_today = max(constituencies, key=lambda c: c["today"])
        cards.append({"tone": "bad" if worst["status"] == "critical" else "warn", "title": f"{worst['name']} needs attention",
                      "detail": f"{worst['achieved']:,} of {worst['target']:,} reached ({worst['percent'] or 0:g}%), gap of {worst['gap']:,}. Consider a visit and a call-centre push."})
        if best_today["today"]:
            cards.append({"tone": "good", "title": f"{best_today['name']} is leading today",
                          "detail": f"{best_today['today']:,} supporters captured since midnight."})
    if summary["totals"]["pending"]:
        cards.append({"tone": "warn" if (backlog_days or 99) > 7 else "info",
                      "title": f"{summary['totals']['pending']:,} records awaiting verification",
                      "detail": (f"At this week's verification rate the queue clears in about {round(backlog_days)} days."
                                 if backlog_days <= 60 else "At this week's verification rate that would take months. Put more call-centre time on the Verify queue.")
                      if backlog_days
                      else "No records were verified this week. Put the call centre on the Verify queue."})
    peak = max(range(24), key=lambda h: hourly[h])
    if hourly[peak]:
        cards.append({"tone": "info", "title": f"Busiest hour today: {peak:02d}:00–{(peak + 1) % 24:02d}:00",
                      "detail": f"{hourly[peak]:,} captures in that hour. Schedule field teams around it."})

    return {
        "today": today_n, "yesterday_same_time": yday_to_now, "last7": last7, "prev7": prev7, "pace": pace,
        "days_left": days_left, "projected": round(projected) if projected is not None else None, "required_pace": required,
        "hourly": hourly, "backlog_days": backlog_days, "constituencies": constituencies, "cards": cards[:6],
    }
