"""Builds a ready-to-open GeoLibre project (.geolibre.json, format 0.1.0) for the GIS Lab.

Everything embedded is aggregate (ward totals, k-anonymous grid cells, station
counts): the same privacy rule as the other GIS exports. Schema follows
GeoLibre v3's `GeoLibreLayer` / `LayerStyle` types; fields we don't set fall
back to GeoLibre's defaults.
"""
import html
from datetime import datetime

from app.core.clock import TZ

# Sequential light → Kenyan green. The low end is split finely so early-campaign
# differences (5% vs 11%) are visible instead of every ward sharing one pale step.
RAMP = [(0, "#e3f1e9", "Under 5%"), (5, "#bfe2cd", "5–9%"), (10, "#8fcfaa", "10–24%"), (25, "#57b482", "25–49%"),
        (50, "#2a965f", "50–74%"), (75, "#0f7a47", "75–99%"), (100, "#00552f", "100%+")]
# One fixed hue per constituency (validated for colour-blind separation; always direct-labelled).
CONSTITUENCY_COLORS = {"Changamwe": "#0b7fa6", "Jomvu": "#c9a227", "Kisauni": "#006b3f",
                       "Likoni": "#bb1e10", "Mvita": "#7b4fb8", "Nyali": "#e07b39"}
INK = "#0b1f3a"
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


_NUM = {"kind": "number", "format": {"thousands": True}}


def build_project(cons_fc: dict, wards_fc: dict, grid_fc: dict, stations_fc: dict, *, briefing: bool = False) -> dict:
    """`briefing=True` adds the story map, which GeoLibre opens in presentation mode;
    the default opens straight into the analysis workspace."""
    stamp = datetime.now(TZ).strftime("%d %b %Y %H:%M")
    cons = _layer("constituencies", "Constituencies (6)", cons_fc, {
        "fillColor": "#94a3b8", "fillOpacity": 0.4, "strokeColor": INK, "strokeWidth": 2.5, "strokeWidthUnit": "pixels",
        "vectorStyleMode": "categorized", "vectorStyleProperty": "name",
        "vectorStyleStops": [{"value": n, "color": c, "label": n} for n, c in CONSTITUENCY_COLORS.items()],
        "labels": {"enabled": True, "field": "name", "expression": "", "placement": "point", "size": 16,
                   "color": INK, "haloColor": "#ffffff", "haloWidth": 2.2, "minZoom": 0, "maxZoom": 12.6},
    }, {
        "titleField": "name",
        "fields": [
            {"field": "wards", "label": "Wards", "kind": "number"},
            {"field": "achieved", "label": "Reached", **_NUM, "hover": True},
            {"field": "target", "label": "Target", **_NUM},
            {"field": "percent", "label": "Progress", "kind": "number", "format": {"decimals": 1, "suffix": "%"}, "hover": True},
            {"field": "gap", "label": "Gap", **_NUM},
            {"field": "registered_voters", "label": "Registered (IEBC)", **_NUM},
        ],
    })
    ward_popup = {
        "titleField": "name",
        "fields": [
            {"field": "constituency", "label": "Constituency", "hover": True},
            {"field": "achieved", "label": "Reached", **_NUM, "hover": True},
            {"field": "target", "label": "Target", **_NUM},
            {"field": "percent", "label": "Progress", "kind": "number", "format": {"decimals": 1, "suffix": "%"}, "hover": True},
            {"field": "gap", "label": "Gap", **_NUM},
            {"field": "supporters", "label": "Supporters", **_NUM},
            {"field": "visits_completed", "label": "Visits done", "kind": "number"},
            {"field": "registered_voters", "label": "Registered (IEBC)", **_NUM},
        ],
    }
    # Ward boundaries + names on top of the constituency colours; clicking a ward shows its numbers.
    wards = _layer("wards", "Wards (30): boundaries & names", wards_fc, {
        "fillColor": "#ffffff", "fillOpacity": 0.01, "strokeColor": "#ffffff", "strokeWidth": 1.4, "strokeWidthUnit": "pixels",
        "labels": {"enabled": True, "field": "name", "expression": "", "placement": "point", "size": 12,
                   "color": INK, "haloColor": "#ffffff", "haloWidth": 1.6, "minZoom": 11.6, "maxZoom": 24},
    }, ward_popup)
    progress = _layer("progress", "Ward progress (% of target)", wards_fc, {
        "fillColor": RAMP[0][1], "fillOpacity": 0.85, "strokeColor": "#ffffff", "strokeWidth": 1.4, "strokeWidthUnit": "pixels",
        "vectorStyleMode": "graduated", "vectorStyleProperty": "percent", "vectorStyleStops": _stops(RAMP),
        "vectorStyleClassCount": len(RAMP),
    }, ward_popup, visible=False)
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
        "mapView": {"center": [39.665, -4.03], "zoom": 11.2, "bearing": 0, "pitch": 0},
        "basemapStyleUrl": BASEMAP,
        "basemapVisible": True,
        "basemapOpacity": 1,
        # Bottom → top. Toggle "Constituencies" off and "Ward progress" on for the performance view.
        "layers": [cons, progress, grid, wards, stations],
        "styles": {},
        "legend": {"title": "Mombasa County", "groupByLayer": True},
        "widgets": [
            {"id": "w-cons", "layerId": "wards", "type": "bar", "category": "constituency", "aggregation": "sum",
             "valueField": "achieved", "title": "Reached by constituency", "color": "#006b3f"},
            {"id": "w-gap", "layerId": "constituencies", "type": "bar", "category": "name", "aggregation": "sum",
             "valueField": "gap", "title": "Gap to target by constituency", "color": "#bb1e10"},
            {"id": "w-pct", "layerId": "wards", "type": "histogram", "field": "percent", "bins": 10,
             "title": "Wards by % of target", "color": "#0b7fa6"},
        ],
        **({"storymap": _story(wards_fc)} if briefing else {}),
        "metadata": {"generated": stamp, "privacy": "Aggregates only. No names, phone numbers or ID numbers."},
    }
