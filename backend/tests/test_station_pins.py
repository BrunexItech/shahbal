from app.core.db import SessionLocal
from app.modules.geo.service import seed_stations
from tests.conftest import make_user


async def _station(client, headers, name):
    return next(x for x in (await client.get("/api/v1/geo/stations", params={"q": name}, headers=headers)).json() if x["name"] == name)


async def test_field_pins_wait_for_approval_and_survive_reseeding(client, admin, wards):
    async with SessionLocal() as s:
        await seed_stations(s)
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    lead = await make_user(client, admin, "ward_coordinator", ward=wards["Tudor"])
    outsider = await make_user(client, admin, "field_agent", ward=wards["Likoni"])
    sparki = await _station(client, admin, "Sparki Primary School")
    assert sparki["location_quality"] == "exact"
    here = {"latitude": sparki["latitude"] + 0.0002, "longitude": sparki["longitude"] + 0.0002}
    url = f"/api/v1/geo/stations/{sparki['id']}/pin"

    # Weak GPS, the wrong place, or someone else's ward are all refused.
    assert (await client.post(url, json={**here, "accuracy": 80}, headers=agent)).status_code == 422
    likoni = {"latitude": -4.0905, "longitude": 39.6560, "accuracy": 10}
    assert (await client.post(url, json=likoni, headers=agent)).status_code == 422
    assert (await client.post(url, json={**here, "accuracy": 10}, headers=outsider)).status_code == 404

    r = await client.post(url, json={**here, "accuracy": 12}, headers=agent)
    assert r.status_code == 200 and r.json()["pin_pending"] is True
    assert r.json()["latitude"] == sparki["latitude"]  # nothing moves until approved
    assert (await client.get("/api/v1/geo/stations/pins", headers=agent)).status_code == 403
    assert (await client.post(f"{url}/approve", headers=agent)).status_code == 403

    pins = (await client.get("/api/v1/geo/stations/pins", headers=lead)).json()
    assert [p["station"] for p in pins] == ["Sparki Primary School"] and pins[0]["pin_by"] and 20 < pins[0]["moved_m"] < 40
    r = await client.post(f"{url}/approve", headers=lead)
    assert r.status_code == 200 and r.json()["location_quality"] == "verified" and r.json()["pin_pending"] is False
    assert r.json()["latitude"] == round(here["latitude"], 6)

    # Reloading the IEBC list never overwrites a pin confirmed on site.
    async with SessionLocal() as s:
        await seed_stations(s)
    again = await _station(client, admin, "Sparki Primary School")
    assert again["latitude"] == round(here["latitude"], 6) and again["location_quality"] == "verified"


async def test_managers_cannot_approve_their_own_pin_and_hq_pins_apply_directly(client, admin, wards):
    async with SessionLocal() as s:
        await seed_stations(s)
    lead = await make_user(client, admin, "ward_coordinator", ward=wards["Tudor"])
    sparki = await _station(client, admin, "Sparki Primary School")
    here = {"latitude": sparki["latitude"], "longitude": sparki["longitude"], "accuracy": 8}
    url = f"/api/v1/geo/stations/{sparki['id']}/pin"
    assert (await client.post(url, json=here, headers=lead)).json()["pin_pending"] is True
    assert (await client.post(f"{url}/approve", headers=lead)).status_code == 403
    assert (await client.post(f"{url}/reject", headers=admin)).json()["pin_pending"] is False

    r = (await client.post(url, json=here, headers=admin)).json()
    assert r["pin_pending"] is False and r["location_quality"] == "verified"
