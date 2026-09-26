"""Daily assignments: coordinators plan agents' days in their area; agents tick off their own."""
from datetime import timedelta

from app.core.clock import TZ, utcnow
from tests.conftest import make_user, voter_payload


def today():
    return utcnow().astimezone(TZ).date()


async def test_plan_tick_off_and_progress(client, admin, wards):
    tudor, likoni = wards["Tudor"], wards["Likoni"]
    lead = await make_user(client, admin, "ward_coordinator", ward=tudor)
    agent = await make_user(client, admin, "field_agent", ward=tudor)
    far = await make_user(client, admin, "field_agent", ward=likoni)
    me = (await client.get("/api/v1/auth/me", headers=agent)).json()
    far_id = (await client.get("/api/v1/auth/me", headers=far)).json()["id"]

    body = {"user_id": me["id"], "day": today().isoformat(), "title": "Door to door, Tudor Estate", "target_captures": 5, "repeat_days": 2}
    assert (await client.post("/api/v1/assignments", json=body, headers=lead)).json() == {"created": 3}
    assert (await client.post("/api/v1/assignments", json={**body, "user_id": far_id, "repeat_days": 0}, headers=lead)).status_code == 403
    past = {**body, "day": (today() - timedelta(days=1)).isoformat()}
    assert (await client.post("/api/v1/assignments", json=past, headers=lead)).status_code == 422
    assert (await client.post("/api/v1/assignments", json=body, headers=agent)).status_code == 403  # agents don't plan

    await client.post("/api/v1/voters", headers=agent, json=voter_payload(tudor, national_id="90000001"))
    mine = (await client.get("/api/v1/assignments", headers=agent)).json()
    assert [a["name"] for a in mine["agents"]] == ["Field Agent User"]
    row = mine["agents"][0]
    assert row["captured"] == 1 and len(row["tasks"]) == 1 and row["tasks"][0]["target_captures"] == 5
    tomorrow = (await client.get("/api/v1/assignments", params={"day": (today() + timedelta(days=1)).isoformat()}, headers=agent)).json()
    assert len(tomorrow["agents"][0]["tasks"]) == 1

    tid = row["tasks"][0]["id"]
    assert (await client.patch(f"/api/v1/assignments/{tid}", json={"status": "skipped"}, headers=agent)).status_code == 422  # needs a reason
    assert (await client.patch(f"/api/v1/assignments/{tid}", json={"title": "Something else"}, headers=agent)).status_code == 403
    assert (await client.patch(f"/api/v1/assignments/{tid}", json={"status": "done", "report": "Covered 40 homes"}, headers=agent)).status_code == 200
    # The other agent can't see or touch it; the coordinator sees both agents in the ward.
    assert (await client.patch(f"/api/v1/assignments/{tid}", json={"status": "pending"}, headers=far)).status_code == 404
    board = (await client.get("/api/v1/assignments", headers=lead)).json()
    assert [a["name"] for a in board["agents"]] == ["Field Agent User"] and board["agents"][0]["tasks"][0]["status"] == "done"
    everyone = (await client.get("/api/v1/assignments", headers=admin)).json()
    assert len(everyone["agents"]) == 2
    assert (await client.delete(f"/api/v1/assignments/{tid}", headers=lead)).status_code == 204
