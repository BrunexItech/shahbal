"""Find a place on the map: our own wards and polling centres first, then any real
place in Mombasa from OpenStreetMap (Photon). Outside lookups are cached, limited to
the county's box and rate-limited, so the public service is used politely."""
import time
from collections import OrderedDict

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope import ward_scope
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.mapping.service import ward_boundaries
from app.modules.users.models import User

PHOTON = "https://photon.komoot.io/api/"
BBOX = "39.52,-4.16,39.78,-3.93"  # Mombasa County (lon/lat)
_cache: "OrderedDict[str, tuple[float, list[dict]]]" = OrderedDict()
CACHE_SECONDS, CACHE_SIZE = 24 * 3600, 500


def _centroids() -> dict[str, tuple[float, float]]:
    out = {}
    for f in ward_boundaries()["features"]:
        g = f["geometry"]
        ring = (g["coordinates"][0] if g["type"] == "Polygon" else max(g["coordinates"], key=lambda p: len(p[0]))[0])
        out[f["properties"]["code"]] = (sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring))
    return out


async def local_matches(session: AsyncSession, user: User, q: str) -> list[dict]:
    like = f"%{q}%"
    cents = _centroids()
    wards = (await session.execute(
        select(Ward, Constituency.name).join(Constituency, Constituency.id == Ward.constituency_id)
        .where(Ward.name.ilike(like), ward_scope(user)).limit(4)
    )).all()
    out = [{"kind": "ward", "id": w.id, "label": f"{w.name} ward", "sub": cn, "lat": cents[w.code][0], "lng": cents[w.code][1]}
           for w, cn in wards if w.code in cents]
    stations = (await session.execute(
        select(PollingStation, Ward.name).join(Ward, Ward.id == PollingStation.ward_id)
        .where(PollingStation.name.ilike(like), PollingStation.is_active.is_(True), PollingStation.latitude.is_not(None), ward_scope(user))
        .limit(5)
    )).all()
    out += [{"kind": "station", "id": s.id, "label": s.name, "sub": f"Polling centre · {wn}", "lat": s.latitude, "lng": s.longitude}
            for s, wn in stations]
    return out


async def osm_matches(q: str) -> list[dict]:
    key = q.lower()
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        _cache.move_to_end(key)
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=6, headers={"User-Agent": "TeamShahbal-CampaignHQ/1.0 (map search)"}) as client:
            r = await client.get(PHOTON, params={"q": q, "limit": 8, "bbox": BBOX, "lang": "en"})
            r.raise_for_status()
            feats = r.json().get("features", [])
    except (httpx.HTTPError, ValueError):
        return []  # the map still works with our own places
    out = []
    for f in feats:
        lng, lat = f["geometry"]["coordinates"]
        p = f.get("properties", {})
        name = p.get("name") or p.get("street") or q
        sub = ", ".join(x for x in (p.get("street") if p.get("name") else None, p.get("district") or p.get("locality"), p.get("city")) if x)
        kind = (p.get("osm_value") or "place").replace("_", " ")
        out.append({"kind": "place", "id": f"osm-{p.get('osm_type', '')}{p.get('osm_id', '')}", "label": name,
                    "sub": f"{kind.capitalize()}{' · ' + sub if sub else ''}", "lat": lat, "lng": lng})
    _cache[key] = (time.monotonic(), out)
    if len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return out
