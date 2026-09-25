"""Analytics series: capture trends over a chosen window, and who our supporters are.

Scoped exactly like the Command Centre (a coordinator sees their constituency)."""
from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased

from app.core.clock import local_date, local_midnight, utcnow
from app.core.deps import Ctx
from app.core.scope import voter_scope
from app.modules.geo.models import Constituency, Ward
from app.modules.voters.models import Gender, Source, Status, Support, Voter


async def trends(ctx: Ctx, days: int) -> dict:
    s, vs = ctx.session, voter_scope(ctx.user)
    live = Voter.status != Status.rejected
    start = local_midnight(days - 1)
    day = local_date(Voter.created_at)
    rows = {d: (c, v, sp) for d, c, v, sp in (await s.execute(
        select(day, func.count(), func.count(case((Voter.status == Status.verified, 1))),
               func.count(case((Voter.support == Support.supporter, 1))))
        .where(vs, live, Voter.created_at >= start).group_by(day)
    )).all()}
    before = (await s.execute(select(func.count()).where(vs, live, Voter.created_at < start))).scalar_one()
    prev = (await s.execute(select(func.count()).where(vs, live, Voter.created_at >= local_midnight(2 * days - 1), Voter.created_at < start))).scalar_one()
    series, running = [], before
    for i in range(days):
        d: date = local_midnight(days - 1 - i).date()
        c, v, sp = rows.get(d, (0, 0, 0))
        running += c
        series.append({"date": d.isoformat(), "captured": c, "verified": v, "supporters": sp, "cumulative": running})
    # Constituency small multiples: daily captures per constituency over the window.
    cons_rows = (await s.execute(
        select(Constituency.name, day, func.count()).join(Ward, Ward.constituency_id == Constituency.id)
        .join(Voter, Voter.ward_id == Ward.id).where(vs, live, Voter.created_at >= start).group_by(Constituency.name, day)
    )).all()
    per: dict[str, dict] = {}
    for name, d, c in cons_rows:
        per.setdefault(name, {})[d] = c
    dates = [date.fromisoformat(x["date"]) for x in series]
    total = sum(x["captured"] for x in series)
    best = max(series, key=lambda x: x["captured"]) if series else None
    return {
        "days": days, "series": series, "total": total, "previous": prev, "avg": round(total / days, 1),
        "best": best, "start_total": before,
        "constituencies": [{"name": n, "series": [per[n].get(d, 0) for d in dates], "total": sum(per[n].values())} for n in sorted(per)],
    }


def _age_band(year: int | None, now_year: int) -> str:
    if not year:
        return "Unknown"
    age = now_year - year
    for hi, label in ((24, "18–24"), (34, "25–34"), (44, "35–44"), (54, "45–54"), (64, "55–64")):
        if age <= hi:
            return label
    return "65+"


async def supporters(ctx: Ctx) -> dict:
    s, vs = ctx.session, voter_scope(ctx.user)
    live = Voter.status != Status.rejected
    total, verified, sup, reach, opted, new_sup, sup_reach = (await s.execute(select(
        func.count(), func.count(case((Voter.status == Status.verified, 1))),
        func.count(case((Voter.support == Support.supporter, 1))),
        func.count(case((Voter.opted_out.is_(False), 1))), func.count(case((Voter.opted_out.is_(True), 1))),
        func.count(case(((Voter.support == Support.supporter) & (Voter.created_at >= local_midnight(6)), 1))),
        func.count(case(((Voter.support == Support.supporter) & Voter.opted_out.is_(False), 1))),
    ).where(vs, live))).one()
    mix = {k.value: v for k, v in (await s.execute(select(Voter.support, func.count()).where(vs, live).group_by(Voter.support))).all()}
    gender = {(k.value if k else "unknown"): v for k, v in (await s.execute(select(Voter.gender, func.count()).where(vs, live).group_by(Voter.gender))).all()}
    sup_gender = {(k.value if k else "unknown"): v for k, v in (await s.execute(
        select(Voter.gender, func.count()).where(vs, live, Voter.support == Support.supporter).group_by(Voter.gender))).all()}
    years = (await s.execute(select(Voter.birth_year, Voter.support, func.count()).where(vs, live).group_by(Voter.birth_year, Voter.support))).all()
    ny = utcnow().year
    bands: dict[str, dict] = {}
    for y, spt, n in years:
        b = bands.setdefault(_age_band(y, ny), {"band": _age_band(y, ny), "people": 0, "supporters": 0})
        b["people"] += n
        if spt == Support.supporter:
            b["supporters"] += n
    order = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+", "Unknown"]
    cons = (await s.execute(
        select(Constituency.name, func.count(), func.count(case((Voter.support == Support.supporter, 1))),
               func.count(case((Voter.support == Support.undecided, 1))))
        .join(Ward, Ward.constituency_id == Constituency.id).join(Voter, Voter.ward_id == Ward.id)
        .where(vs, live).group_by(Constituency.name).order_by(Constituency.name)
    )).all()
    referrer = aliased(Voter)
    recruiters = (await s.execute(
        select(referrer.full_name, Ward.name, func.count(Voter.id))
        .join(referrer, referrer.share_code == Voter.referred_by).join(Ward, Ward.id == referrer.ward_id)
        .where(vs, live).group_by(referrer.id, referrer.full_name, Ward.name).order_by(func.count(Voter.id).desc()).limit(5)
    )).all()
    referred = (await s.execute(select(func.count()).where(vs, live, Voter.referred_by.is_not(None)))).scalar_one()
    sources = {k.value: v for k, v in (await s.execute(select(Voter.source, func.count()).where(vs, live).group_by(Voter.source))).all()}
    return {
        "total": total, "verified": verified, "supporters": sup, "reachable": reach, "opted_out": opted, "new_supporters_7d": new_sup,
        "funnel": [{"stage": "Captured", "value": total}, {"stage": "Verified", "value": verified},
                   {"stage": "Supporters", "value": sup}, {"stage": "Supporters we can message", "value": sup_reach}],
        "mix": mix, "gender": gender, "supporter_gender": sup_gender,
        "age": [bands[b] for b in order if b in bands],
        "constituencies": [{"name": n, "people": p, "supporters": sp, "undecided": u, "share": round(sp / p * 100, 1) if p else None} for n, p, sp, u in cons],
        "sources": sources,
        "referred": referred,
        "recruiters": [{"name": n, "ward": w, "signups": c} for n, w, c in recruiters],
        "labels": {"gender": [g.value for g in Gender], "support": [x.value for x in Support], "source": [x.value for x in Source]},
    }
