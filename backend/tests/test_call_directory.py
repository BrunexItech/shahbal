from tests.conftest import make_user, voter_payload


async def test_directory_filters_call_status_and_pick_to_call(client, admin, wards):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    a = (await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="70000001"))).json()["id"]
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="70000002", phone="0712700002"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(bamburi, national_id="70000003", phone="0712700003"))
    agent = await make_user(client, admin, "call_agent", email="caller@campaign.co.ke")
    other = await make_user(client, admin, "call_agent", email="caller2@campaign.co.ke")

    d = (await client.get("/api/v1/calls/directory", params={"ward_id": tudor.id}, headers=agent)).json()
    assert d["total"] == 2 and all(x["ward"] == "Tudor" and x["phone"].startswith("+254") and x["calls"] == 0 for x in d["items"])

    claim = await client.post(f"/api/v1/calls/claim/{a}", headers=agent)
    assert claim.status_code == 200 and claim.json()["voter"]["id"] == a
    busy = await client.post(f"/api/v1/calls/claim/{a}", headers=other)
    assert busy.status_code == 409 and "calling this person" in busy.json()["detail"]
    seen_by_other = (await client.get("/api/v1/calls/directory", params={"ward_id": tudor.id}, headers=other)).json()
    assert any(x["id"] == a and x["busy_with"] for x in seen_by_other["items"])

    await client.post("/api/v1/calls", headers=agent, json={"voter_id": a, "queue": "persuade", "outcome": "no_answer"})
    called = (await client.get("/api/v1/calls/directory", params={"called": "called"}, headers=agent)).json()
    assert [x["id"] for x in called["items"]] == [a] and called["items"][0]["last_outcome"] == "no_answer" and called["items"][0]["calls"] == 1
    never = (await client.get("/api/v1/calls/directory", params={"called": "never"}, headers=agent)).json()
    assert never["total"] == 2 and a not in [x["id"] for x in never["items"]]
    assert (await client.get("/api/v1/calls/directory", params={"called": "no_answer", "constituency_id": tudor.constituency_id}, headers=agent)).json()["total"] == 1

    field = await make_user(client, admin, "field_agent", ward=tudor)
    assert (await client.get("/api/v1/calls/directory", headers=field)).status_code == 403
