"""Read models for the live coverage map and the GIS Lab exports.

Privacy rule for anything leaving the app (GIS Lab): aggregates only, never a
name/phone/ID, and any grid cell with fewer than MIN_CELL records is suppressed
so individuals can't be located from a sparse cell."""
import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import case, func, select

from app.core.clock import local_midnight, utcnow
from app.core.deps import Ctx
from app.core.scope import voter_scope, ward_scope
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.visits.models import Visit, VisitStatus
from app.modules.voters.models import Status, Support, Voter

BOUNDARIES = Path(__file__).resolve().parents[1] / "geo" / "data" / "mombasa-wards.geojson"
MIN_CELL = 5
CELL_DEG = 0.005  # ≈ 550 m at Mombasa's latitude


@lru_cache(maxsize=1)
def ward_boundaries() -> dict:
    return json.loads(BOUNDARIES.read_text())


def _pct(a: int, t: int) -> float | None:
    return round(a / t * 100, 1) if t else None


class MapService:
    def __init__(self, ctx: Ctx):
        self.s = ctx.session
        self.user = ctx.user

    async def ward_stats(self) -> list[dict]:
        vs = voter_scope(self.user)
        live = Voter.status != Status.rejected
        rows = (await self.s.execute(
            select(Ward.id, Ward.code, Ward.name, Constituency.name, Ward.target, Ward.registered_voters,
                   func.count(case((live, 1))), func.count(case((Voter.status == Status.verified, 1))),
                   func.count(case(((Voter.support == Support.supporter) & live, 1))))
            .join(Constituency, Constituency.id == Ward.constituency_id)
            .outerjoin(Voter, (Voter.ward_id == Ward.id) & vs)
            .where(ward_scope(self.user)).group_by(Ward.id, Constituency.name).order_by(Ward.code)
        )).all()
        visits = {w: (done, last, upcoming) for w, done, last, upcoming in (await self.s.execute(
            select(Visit.ward_id,
                   func.count(case((Visit.status == VisitStatus.completed, 1))),
                   func.max(case((Visit.status == VisitStatus.completed, Visit.completed_at))),
                   func.count(case(((Visit.status == VisitStatus.scheduled) & (Visit.scheduled_at >= utcnow()), 1))))
            .group_by(Visit.ward_id)
        )).all()}
        out = []
        for wid, code, name, cons, target, reg, achieved, verified, supporters in rows:
            done, last, upcoming = visits.get(wid, (0, None, 0))
            out.append({"id": wid, "code": code, "name": name, "constituency": cons, "target": target, "registered_voters": reg,
                        "achieved": achieved, "verified": verified, "supporters": supporters, "percent": _pct(achieved, target),
                        "gap": max(target - achieved, 0), "visits_completed": done, "visits_upcoming": upcoming,
                        "last_visit_at": last.isoformat() if last else None})
        return out

    async def overview(self) -> dict:
        wards = await self.ward_stats()
        allowed = {w["id"] for w in wards}
        stations = (await self.s.execute(
            select(PollingStation.id, PollingStation.name, PollingStation.code, PollingStation.ward_id, PollingStation.latitude,
                   PollingStation.longitude, PollingStation.registered_voters, func.count(Voter.id))
            .outerjoin(Voter, (Voter.station_id == PollingStation.id) & voter_scope(self.user) & (Voter.status != Status.rejected))
            .where(PollingStation.latitude.is_not(None), PollingStation.is_active.is_(True), PollingStation.ward_id.in_(allowed))
            .group_by(PollingStation.id)
        )).all()
        visits = (await self.s.execute(
            select(Visit.id, Visit.title, Visit.venue, Visit.status, Visit.scheduled_at, Visit.ward_id,
                   func.coalesce(Visit.checkin_lat, PollingStation.latitude), func.coalesce(Visit.checkin_lng, PollingStation.longitude))
            .outerjoin(PollingStation, PollingStation.id == Visit.station_id)
            .where(Visit.ward_id.in_(allowed), Visit.status != VisitStatus.cancelled, Visit.scheduled_at >= local_midnight(60))
            .order_by(Visit.scheduled_at)
        )).all()
        return {
            "wards": wards,
            "stations": [{"id": i, "name": n, "code": c, "ward_id": w, "lat": la, "lng": lo, "registered_voters": r, "captured": k}
                         for i, n, c, w, la, lo, r, k in stations],
            "visits": [{"id": i, "title": t, "venue": v, "status": s.value, "scheduled_at": at.isoformat(), "ward_id": w, "lat": la, "lng": lo}
                       for i, t, v, s, at, w, la, lo in visits],
        }

    # ---- GIS Lab exports (aggregates only) ----------------------------------------
    async def export_wards(self) -> dict:
        stats = {w["code"]: w for w in await self.ward_stats()}
        feats = []
        for f in ward_boundaries()["features"]:
            s = stats.get(f["properties"]["code"])
            if s is None:
                continue
            props = {k: s[k] for k in ("code", "name", "constituency", "target", "achieved", "verified", "supporters", "percent",
                                        "gap", "visits_completed", "visits_upcoming", "registered_voters")}
            feats.append({"type": "Feature", "properties": props, "geometry": f["geometry"]})
        return {"type": "FeatureCollection", "features": feats}

    async def export_grid(self) -> dict:
        lat_c = func.floor(Voter.capture_lat / CELL_DEG)
        lng_c = func.floor(Voter.capture_lng / CELL_DEG)
        rows = (await self.s.execute(
            select(lat_c, lng_c, func.count(), func.count(case((Voter.support == Support.supporter, 1))))
            .where(voter_scope(self.user), Voter.status != Status.rejected, Voter.capture_lat.is_not(None))
            .group_by(lat_c, lng_c).having(func.count() >= MIN_CELL)
        )).all()
        feats = []
        for la, lo, n, sup in rows:
            y0, x0 = float(la) * CELL_DEG, float(lo) * CELL_DEG
            ring = [[round(x0, 5), round(y0, 5)], [round(x0 + CELL_DEG, 5), round(y0, 5)], [round(x0 + CELL_DEG, 5), round(y0 + CELL_DEG, 5)],
                    [round(x0, 5), round(y0 + CELL_DEG, 5)], [round(x0, 5), round(y0, 5)]]
            feats.append({"type": "Feature", "properties": {"captures": n, "supporters": sup, "supporter_share": _pct(sup, n)},
                          "geometry": {"type": "Polygon", "coordinates": [ring]}})
        return {"type": "FeatureCollection", "features": feats}

    async def export_stations(self) -> dict:
        ov = await self.overview()
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {k: s[k] for k in ("name", "code", "registered_voters", "captured")},
             "geometry": {"type": "Point", "coordinates": [s["lng"], s["lat"]]}} for s in ov["stations"]]}
