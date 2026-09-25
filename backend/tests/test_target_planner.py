from sqlalchemy import select, update

from app.core.db import SessionLocal
from app.modules.geo.models import Constituency, PollingStation, Ward
from tests.conftest import make_user


async def _set_registered(values: dict[str, int]):
    async with SessionLocal() as s:
        for name, n in values.items():
            await s.execute(update(Ward).where(Ward.name == name).values(registered_voters=n))
        await s.commit()


async def test_split_by_registered_adds_up_exactly_and_previews_without_saving(client, admin, wards):
    async with SessionLocal() as s:
        mvita = (await s.execute(select(Constituency).where(Constituency.name == "Mvita"))).scalar_one()
        names = [w.name for w in (await s.execute(select(Ward).where(Ward.constituency_id == mvita.id))).scalars()]
    await _set_registered({n: 1000 * (i + 1) for i, n in enumerate(names)})
    body = {"level": "constituency", "area_id": mvita.id, "method": "split_registered", "value": 1001}
    prev = (await client.post("/api/v1/geo/targets/preview", json=body, headers=admin)).json()
    assert prev["unit"] == "wards" and prev["total_proposed"] == 1001 and len(prev["items"]) == len(names)
    assert prev["items"][-1]["proposed"] > prev["items"][0]["proposed"]  # more voters, bigger share
    assert sum(i["current"] for i in prev["items"]) == prev["total_current"]
    async with SessionLocal() as s:  # preview saved nothing
        assert sum(w.target for w in (await s.execute(select(Ward).where(Ward.constituency_id == mvita.id))).scalars()) == prev["total_current"]
    applied = (await client.post("/api/v1/geo/targets/apply", json=body, headers=admin)).json()
    assert applied["total_proposed"] == 1001
    b = (await client.get("/api/v1/dashboard/breakdown", headers=admin)).json()
    assert next(c for c in b["constituencies"] if c["name"] == "Mvita")["target"] == 1001


async def test_percent_of_registered_and_station_level(client, admin, wards):
    await _set_registered({"Tudor": 3000})
    tudor = wards["Tudor"]
    r = (await client.post("/api/v1/geo/targets/preview", json={"level": "county", "method": "percent_registered", "value": 40}, headers=admin)).json()
    assert next(i for i in r["items"] if i["name"] == "Tudor")["proposed"] == 1200
    async with SessionLocal() as s:
        stations = (await s.execute(select(PollingStation).where(PollingStation.ward_id == tudor.id))).scalars().all()
    if stations:
        st = (await client.post("/api/v1/geo/targets/apply", json={"level": "ward", "area_id": tudor.id, "method": "split_equal", "value": 100}, headers=admin)).json()
        assert st["unit"] == "stations" and st["total_proposed"] == 100


async def test_planner_scope_and_validation(client, admin, wards):
    coord = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    other = wards["Bamburi"].constituency_id
    assert (await client.post("/api/v1/geo/targets/preview", json={"level": "constituency", "area_id": other, "method": "split_equal", "value": 10}, headers=coord)).status_code == 403
    assert (await client.post("/api/v1/geo/targets/preview", json={"level": "county", "method": "split_equal", "value": 10}, headers=coord)).status_code == 403
    assert (await client.post("/api/v1/geo/targets/preview", json={"level": "county", "method": "percent_registered", "value": 140}, headers=admin)).status_code == 422
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.post("/api/v1/geo/targets/preview", json={"level": "county", "method": "split_equal", "value": 10}, headers=agent)).status_code == 403


async def test_attention_alerts_are_pinned_to_places(client, admin, wards):
    await client.patch(f"/api/v1/geo/wards/{wards['Tudor'].id}", json={"target": 100}, headers=admin)
    s = (await client.get("/api/v1/dashboard/summary", headers=admin)).json()
    alerts = s["insights"]["alerts"]
    assert alerts and all(a["level"] in ("county", "constituency", "ward") and a["area"] for a in alerts)
    tudor = [a for a in alerts if a["level"] == "ward" and a["area"] == "Tudor"]
    assert tudor and tudor[0]["constituency"] == "Mvita" and "never been visited" in tudor[0]["title"]
