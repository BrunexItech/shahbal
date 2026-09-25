from app.modules.geo.locate import ward_code_at
from tests.conftest import make_user, voter_payload


async def test_audience_tree_people_and_messaging_agree(client, admin, wards):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="40000001", support="supporter"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="40000002", phone="0712000002"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(bamburi, national_id="40000003", phone="0712000003"))
    t = (await client.get("/api/v1/audience/tree", headers=admin)).json()
    assert t["people"] == 3 and t["supporters"] == 1
    mvita = next(c for c in t["constituencies"] if c["name"] == "Mvita")
    assert next(w for w in mvita["wards"] if w["name"] == "Tudor")["reachable"] == 2
    sel = {"audience": {"ward_ids": [tudor.id]}}
    p = (await client.post("/api/v1/audience/people", json=sel, headers=admin)).json()
    assert p["total"] == 2 and p["by_support"].get("supporter") == 1
    assert all("•" in x["phone"] and x["ward"] == "Tudor" for x in p["people"])  # masked, placed
    prev = (await client.post("/api/v1/messaging/preview", json={"channel": "sms", "body": "Habari", "audience": {"ward_ids": [tudor.id]}}, headers=admin)).json()
    assert prev["recipients"] == p["total"]  # the preview is exactly who a message reaches
    agent = await make_user(client, admin, "field_agent", ward=tudor)
    assert (await client.get("/api/v1/audience/tree", headers=agent)).status_code == 403


async def test_quick_visit_locates_ward_and_respects_scope(client, admin, wards):
    lat, lng = -4.0621, 39.6663
    code = ward_code_at(lat, lng)
    ward = next(w for w in wards.values() if w.code == code)
    v = (await client.post("/api/v1/visits/quick", json={"venue": "Market corner", "latitude": lat, "longitude": lng}, headers=admin))
    assert v.status_code == 201, v.text
    assert v.json()["ward_id"] == ward.id and v.json()["status"] == "in_progress"
    places = (await client.get("/api/v1/map/overview", headers=admin)).json()["places"]
    assert any(p["venue"] == "Market corner" and p["exact"] for p in places)
    other = next(w for w in wards.values() if w.id != ward.id)
    agent = await make_user(client, admin, "field_agent", ward=other)
    assert (await client.post("/api/v1/visits/quick", json={"venue": "Shop front", "latitude": lat, "longitude": lng}, headers=agent)).status_code == 403
    sea = await client.post("/api/v1/visits/quick", json={"venue": "Boat", "latitude": -4.3, "longitude": 39.9}, headers=admin)
    assert sea.status_code == 422


async def test_trends_and_supporter_profile(client, admin, wards):
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="41000001", support="supporter", gender="female", birth_year=1995))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="41000002", phone="0712000009", support="undecided"))
    t = (await client.get("/api/v1/dashboard/trends", params={"days": 14}, headers=admin)).json()
    assert len(t["series"]) == 14 and t["total"] == 2 and t["series"][-1]["cumulative"] == 2
    assert t["constituencies"][0]["name"] == "Mvita" and sum(t["constituencies"][0]["series"]) == 2
    sp = (await client.get("/api/v1/dashboard/supporters", headers=admin)).json()
    assert sp["supporters"] == 1 and sp["funnel"][0]["value"] == 2 and sp["supporter_gender"].get("female") == 1
    assert any(b["band"] == "25–34" and b["supporters"] == 1 for b in sp["age"])
    assert sp["constituencies"][0]["share"] == 50.0


async def test_region_picks_add_up(client, admin, wards):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="42000001"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(bamburi, national_id="42000002", phone="0712000022"))
    both = {"audience": {"constituency_ids": [tudor.constituency_id], "ward_ids": [bamburi.id]}}
    assert (await client.post("/api/v1/audience/people", json=both, headers=admin)).json()["total"] == 2
