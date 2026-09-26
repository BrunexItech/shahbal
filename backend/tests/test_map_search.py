"""Map search: our own wards and polling centres first, then real places (outside lookup stubbed)."""
from app.core.db import SessionLocal
from app.modules.geo.service import seed_stations
from app.modules.mapping import search
from tests.conftest import elevate, make_user


async def test_search_finds_our_places_first_then_osm(client, admin, wards, monkeypatch):
    async with SessionLocal() as s:
        await seed_stations(s)

    async def fake_osm(q):
        return [{"kind": "place", "id": "osm-N1", "label": "Tudor Water Tank", "sub": "Tower", "lat": -4.05, "lng": 39.67}]

    monkeypatch.setattr("app.modules.mapping.router.osm_matches", fake_osm)
    hits = (await client.get("/api/v1/map/search", params={"q": "tudor"}, headers=admin)).json()
    kinds = [h["kind"] for h in hits]
    assert kinds[0] == "ward" and hits[0]["label"] == "Tudor ward" and "station" in kinds and kinds[-1] == "place"
    # Area rules apply: a Likoni agent doesn't get Tudor's ward or centres, only the public place.
    agent = await elevate(client, await make_user(client, admin, "field_agent", ward=wards["Likoni"]), "Password!1")
    theirs = (await client.get("/api/v1/map/search", params={"q": "tudor"}, headers=agent)).json()
    assert [h["kind"] for h in theirs] == ["place"]
    assert (await client.get("/api/v1/map/search", params={"q": "t"}, headers=admin)).status_code == 422
    assert search.BBOX  # the outside lookup stays inside Mombasa
