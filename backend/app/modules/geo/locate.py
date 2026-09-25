"""Which ward is this GPS point in? Point-in-polygon over the IEBC ward shapes
(30 small polygons: fast enough in pure Python, no GIS library)."""
import json
from functools import lru_cache
from pathlib import Path

BOUNDARIES = Path(__file__).resolve().parent / "data" / "mombasa-wards.geojson"


def _inside(x: float, y: float, ring: list) -> bool:
    hit = False
    for i in range(len(ring)):
        x1, y1 = ring[i - 1]
        x2, y2 = ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


@lru_cache(maxsize=1)
def _shapes() -> list[tuple[str, list]]:
    out = []
    for f in json.loads(BOUNDARIES.read_text())["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        out.append((f["properties"]["code"], polys))
    return out


def ward_code_at(lat: float, lng: float) -> str | None:
    for code, polys in _shapes():
        for poly in polys:
            if _inside(lng, lat, poly[0]) and not any(_inside(lng, lat, hole) for hole in poly[1:]):
                return code
    return None
