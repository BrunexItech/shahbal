"""War-room aggregates. Everything is computed in SQL and scoped to the caller's
area, so the same endpoint powers the county HQ screen and a ward coordinator's phone.

Definitions (shown in the UI too):
  achieved = records in the area that are not rejected
  gap      = max(target - achieved, 0)
"""
from sqlalchemy import case, func, select

from app.core.clock import local_date, local_midnight
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

        return {
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
