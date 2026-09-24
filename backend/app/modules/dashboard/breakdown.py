"""Captures by area: county → constituency → ward → polling station, in four queries.

Same definitions as the Command Centre (achieved = not rejected; gap = target − achieved)
and the same scoping, so a ward coordinator sees only their ward's slice.
"""
from sqlalchemy import case, func, select

from app.core.clock import local_midnight
from app.core.deps import Ctx
from app.core.scope import voter_scope, ward_scope
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.visits.models import Visit, VisitStatus
from app.modules.voters.models import Status, Support, Voter

METRICS = ("captured", "verified", "supporters", "today", "week", "prev_week")


def _metric_cols():
    live = Voter.status != Status.rejected
    today, week, prev = local_midnight(), local_midnight(6), local_midnight(13)
    return (
        func.count(case((live, 1))).label("captured"),
        func.count(case((Voter.status == Status.verified, 1))).label("verified"),
        func.count(case(((Voter.support == Support.supporter) & live, 1))).label("supporters"),
        func.count(case(((Voter.created_at >= today) & live, 1))).label("today"),
        func.count(case(((Voter.created_at >= week) & live, 1))).label("week"),
        func.count(case(((Voter.created_at >= prev) & (Voter.created_at < week) & live, 1))).label("prev_week"),
    )


def _finish(d: dict) -> dict:
    t, a = d["target"], d["captured"]
    d["gap"] = max(t - a, 0)
    d["percent"] = round(a / t * 100, 1) if t else None
    return d


def _add(into: dict, frm: dict, keys=(*METRICS, "target", "visits_done", "visits_planned")) -> None:
    for k in keys:
        into[k] = into.get(k, 0) + (frm.get(k) or 0)


async def breakdown(ctx: Ctx) -> dict:
    s, user = ctx.session, ctx.user
    vs, ws = voter_scope(user), ward_scope(user)

    ward_rows = (await s.execute(
        select(Ward.id, Ward.code, Ward.name, Ward.target, Ward.registered_voters,
               Constituency.id.label("cid"), Constituency.code.label("ccode"), Constituency.name.label("cname"), *_metric_cols())
        .join(Constituency, Constituency.id == Ward.constituency_id)
        .outerjoin(Voter, (Voter.ward_id == Ward.id) & vs)
        .where(ws).group_by(Ward.id, Constituency.id).order_by(Constituency.code, Ward.code)
    )).all()
    ward_ids = [r.id for r in ward_rows]

    station_rows = (await s.execute(
        select(PollingStation.id, PollingStation.code, PollingStation.name, PollingStation.ward_id,
               PollingStation.registered_voters, PollingStation.target, *_metric_cols())
        .outerjoin(Voter, (Voter.station_id == PollingStation.id) & vs)
        .where(PollingStation.ward_id.in_(ward_ids), PollingStation.is_active.is_(True))
        .group_by(PollingStation.id).order_by(PollingStation.code)
    )).all()

    visit_rows = {r.ward_id: r for r in (await s.execute(
        select(Visit.ward_id,
               func.count(case((Visit.status == VisitStatus.completed, 1))).label("done"),
               func.count(case((Visit.status == VisitStatus.scheduled, 1))).label("planned"),
               func.max(Visit.completed_at).label("last"))
        .where(Visit.ward_id.in_(ward_ids)).group_by(Visit.ward_id)
    )).all()}

    stations_by_ward: dict[str, list[dict]] = {}
    for r in station_rows:
        st = {"id": r.id, "code": r.code, "name": r.name, "registered_voters": r.registered_voters, "target": r.target,
              **{k: getattr(r, k) for k in METRICS}}
        stations_by_ward.setdefault(r.ward_id, []).append(_finish(st))

    cons: dict[str, dict] = {}
    county: dict = {"wards": 0, "stations": 0, **dict.fromkeys((*METRICS, "target", "visits_done", "visits_planned"), 0)}
    for r in ward_rows:
        v = visit_rows.get(r.id)
        stations = sorted(stations_by_ward.get(r.id, []), key=lambda x: -x["captured"])
        w = {"id": r.id, "code": r.code, "name": r.name, "target": r.target, "registered_voters": r.registered_voters,
             **{k: getattr(r, k) for k in METRICS},
             "visits_done": v.done if v else 0, "visits_planned": v.planned if v else 0,
             "last_visit_at": v.last.isoformat() if v and v.last else None,
             "stations": stations,
             # Records captured without a polling station (e.g. voter didn't know it yet).
             "no_station": max(r.captured - sum(x["captured"] for x in stations), 0)}
        _finish(w)
        c = cons.setdefault(r.cid, {"id": r.cid, "code": r.ccode, "name": r.cname, "wards": [], "stations": 0})
        c["wards"].append(w)
        c["stations"] += len(stations)
        _add(c, w)
        _add(county, w)
        county["wards"] += 1
        county["stations"] += len(stations)

    out = []
    for c in cons.values():
        _finish(c)
        c["visited_wards"] = sum(1 for w in c["wards"] if w["visits_done"])
        out.append(c)
    _finish(county)
    county["visited_wards"] = sum(c["visited_wards"] for c in out)
    return {"county": county, "constituencies": out}
