"""Builds a ready-to-open GeoLibre project (.geolibre.json, format 0.1.0) for the GIS Lab.

Everything embedded is aggregate (ward totals, k-anonymous grid cells, station
counts): the same privacy rule as the other GIS exports. Schema follows
GeoLibre v3's `GeoLibreLayer` / `LayerStyle` types; fields we don't set fall
back to GeoLibre's defaults.
"""
import html
from datetime import datetime

from app.core.clock import TZ

# Same sequential ramp as the live coverage map (light → Kenyan green).
RAMP = [(0, "#e8f5ee", "0–24%"), (25, "#b7e0cb", "25–49%"), (50, "#6fc29a", "50–74%"), (75, "#23985f", "75–99%"), (100, "#006b3f", "100%+")]
DENSITY = [(5, "#e6f5fa", "5–19"), (20, "#9fd6ea", "20–49"), (50, "#3fa7cc", "50–99"), (100, "#0b7fa6", "100+")]
BASEMAP = "https://tiles.openfreemap.org/styles/positron"


def _stops(ramp):
    return [{"value": v, "color": c, "label": label} for v, c, label in ramp]


def _layer(layer_id: str, name: str, fc: dict, style: dict, popup: dict, visible: bool = True) -> dict:
    return {
        "id": layer_id,
        "name": name,
        "type": "geojson",
        "source": {"type": "geojson"},
        "visible": visible,
        "opacity": 1,
        "style": {"minZoom": 0, "maxZoom": 24, **style},
        "metadata": {"source": "Campaign HQ export (aggregates only)"},
        "geojson": fc,
        "popup": popup,
        # Read-only analysis copy: editing here would silently diverge from the live system.
        "capabilities": {"query": True, "create": False, "update": False, "delete": False, "export": True},
    }


def _bbox(features: list[dict]) -> list[float] | None:
    xs, ys = [], []
    for f in features:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            for x, y in poly[0]:
                xs.append(x)
                ys.append(y)
    return [min(xs), min(ys), max(xs), max(ys)] if xs else None


def _story(wards_fc: dict) -> dict:
    """One chapter per constituency with its live numbers: a briefing the candidate can scroll."""
    by_cons: dict[str, list[dict]] = {}
    for f in wards_fc["features"]:
        by_cons.setdefault(f["properties"]["constituency"], []).append(f)
    tot_a = sum(f["properties"]["achieved"] for f in wards_fc["features"])
    tot_t = sum(f["properties"]["target"] for f in wards_fc["features"])
    chapters = [{
        "id": "county",
        "title": "Mombasa County",
        "description": f"<p><b>{tot_a:,}</b> supporters reached against a target of <b>{tot_t:,}</b>.</p>"
                       "<p>Scroll to tour each constituency.</p>",
        "alignment": "left",
        "location": {"center": [39.66, -4.04], "zoom": 10.4, "pitch": 0, "bearing": 0},
        "mapAnimation": "flyTo",
    }]
    for name, feats in sorted(by_cons.items()):
        b = _bbox(feats)
        if not b:
            continue
        a = sum(f["properties"]["achieved"] for f in feats)
        t = sum(f["properties"]["target"] for f in feats)
        behind = sorted(feats, key=lambda f: -(f["properties"]["gap"] or 0))[:3]
        lines = "".join(f"<li>{html.escape(f['properties']['name'])}: gap {f['properties']['gap']:,}</li>" for f in behind)
        chapters.append({
            "id": f"c-{name.lower()}",
            "title": html.escape(name),
            "description": f"<p><b>{a:,}</b> of <b>{t:,}</b> ({(a / t * 100 if t else 0):.0f}%).</p><p>Furthest behind:</p><ul>{lines}</ul>",
            "alignment": "left",
            "location": {"center": [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], "zoom": 12.2, "pitch": 30, "bearing": 0},
            "mapAnimation": "flyTo",
        })
    return {"title": "Campaign coverage briefing", "subtitle": "Mombasa County", "byline": "Campaign HQ",
            "footer": "Ward boundaries: IEBC. Base map: OpenFreeMap / OpenStreetMap.", "theme": "dark",
            "showMarkers": False, "chapters": chapters}


def build_project(wards_fc: dict, grid_fc: dict, stations_fc: dict) -> dict:
    stamp = datetime.now(TZ).strftime("%d %b %Y %H:%M")
    wards = _layer("wards", "Ward coverage (% of target)", wards_fc, {
        "fillColor": "#e8f5ee", "fillOpacity": 0.78, "strokeColor": "#ffffff", "strokeWidth": 1.5, "strokeWidthUnit": "pixels",
        "vectorStyleMode": "graduated", "vectorStyleProperty": "percent", "vectorStyleStops": _stops(RAMP),
        "vectorStyleClassCount": len(RAMP),
        "labels": {"enabled": True, "field": "name", "expression": "", "placement": "point", "size": 11,
                   "color": "#0b1f3a", "haloColor": "#ffffff", "haloWidth": 1.4, "minZoom": 0, "maxZoom": 24},
    }, {
        "titleField": "name",
        "fields": [
            {"field": "constituency", "label": "Constituency"},
            {"field": "achieved", "label": "Reached", "kind": "number", "format": {"thousands": True}, "hover": True},
            {"field": "target", "label": "Target", "kind": "number", "format": {"thousands": True}},
            {"field": "percent", "label": "Progress", "kind": "number", "format": {"decimals": 1, "suffix": "%"}, "hover": True},
            {"field": "gap", "label": "Gap", "kind": "number", "format": {"thousands": True}},
            {"field": "supporters", "label": "Supporters", "kind": "number", "format": {"thousands": True}},
            {"field": "visits_completed", "label": "Visits done", "kind": "number"},
            {"field": "registered_voters", "label": "Registered (IEBC)", "kind": "number", "format": {"thousands": True}},
        ],
    })
    grid = _layer("density", "Capture density (≈550 m cells, 5+ only)", grid_fc, {
        "fillColor": "#9fd6ea", "fillOpacity": 0.7, "strokeColor": "#ffffff", "strokeWidth": 0.5, "strokeWidthUnit": "pixels",
        "vectorStyleMode": "graduated", "vectorStyleProperty": "captures", "vectorStyleStops": _stops(DENSITY),
        "vectorStyleClassCount": len(DENSITY),
    }, {
        "fields": [
            {"field": "captures", "label": "Captures", "kind": "number", "hover": True},
            {"field": "supporter_share", "label": "Supporters", "kind": "number", "format": {"decimals": 0, "suffix": "%"}},
        ],
    }, visible=False)
    stations = _layer("stations", "Polling stations", stations_fc, {
        "fillColor": "#0b1f3a", "strokeColor": "#ffffff", "strokeWidth": 2, "strokeWidthUnit": "pixels", "circleRadius": 5,
        "proportionalSizeEnabled": True, "proportionalSizeProperty": "captured", "proportionalSizeMinValue": 0,
        "proportionalSizeMaxValue": 80, "proportionalSizeMinRadius": 4, "proportionalSizeMaxRadius": 12,
    }, {
        "titleField": "name",
        "fields": [
            {"field": "code", "label": "Code"},
            {"field": "captured", "label": "Captured here", "kind": "number", "hover": True},
            {"field": "registered_voters", "label": "Registered (IEBC)", "kind": "number", "format": {"thousands": True}},
        ],
    })
    return {
        "version": "0.1.0",
        "name": f"Mombasa campaign · {stamp}",
        "mapView": {"center": [39.66, -4.04], "zoom": 10.6, "bearing": 0, "pitch": 0},
        "basemapStyleUrl": BASEMAP,
        "basemapVisible": True,
        "basemapOpacity": 1,
        "layers": [grid, wards, stations],
        "styles": {},
        "legend": {"title": "Mombasa campaign coverage", "groupByLayer": True},
        "widgets": [
            {"id": "w-cons", "layerId": "wards", "type": "bar", "category": "constituency", "aggregation": "sum",
             "valueField": "achieved", "title": "Reached by constituency", "color": "#006b3f"},
            {"id": "w-pct", "layerId": "wards", "type": "histogram", "field": "percent", "bins": 10,
             "title": "Wards by % of target", "color": "#0b7fa6"},
        ],
        "storymap": _story(wards_fc),
        "metadata": {"generated": stamp, "privacy": "Aggregates only. No names, phone numbers or ID numbers."},
    }
