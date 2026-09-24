from tests.conftest import make_user, voter_payload


async def read_first_pulse(client, headers) -> dict:
    """The endpoint streams forever (httpx's ASGI test transport can't read an endless
    body), so exercise the exact functions each tick calls, as the viewer."""
    from app.core.db import SessionLocal
    from app.modules.live.service import call_wall, feed, pulse
    from app.modules.users.models import User

    me = (await client.get("/api/v1/auth/me", headers=headers)).json()
    async with SessionLocal() as s:
        user = await s.get(User, me["id"])
        from datetime import datetime, timezone

        return {"pulse": await pulse(s, user), "events": await feed(s, user, datetime(2000, 1, 1, tzinfo=timezone.utc)),
                "calls": await call_wall(s)}


async def test_live_pulse_is_scoped(client, admin, wards):
    await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)
    await client.post("/api/v1/voters", json=voter_payload(wards["Bamburi"], national_id="87651234"), headers=admin)
    hq = await read_first_pulse(client, admin)
    assert hq["pulse"]["captures_today"] == 2 and hq["pulse"]["online_command"] >= 1 and hq["events"]
    coord = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    scoped = await read_first_pulse(client, coord)
    assert scoped["pulse"]["captures_today"] == 1 and scoped["events"] == []  # coordinators: their area only, no county feed


async def test_presence_and_call_wall(client, admin, wards):
    vid = (await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)).json()["id"]
    agent = await make_user(client, admin, "call_agent", email="wall@campaign.co.ke")
    assert (await client.post("/api/v1/live/presence", json={"status": "on_call", "voter_id": vid, "line": "sandbox"}, headers=agent)).status_code == 204
    wall = (await client.get("/api/v1/live/calls", headers=admin)).json()
    assert wall[0]["status"] == "on_call" and wall[0]["voter"] == "Amina Wanjiku"
    assert (await client.get("/api/v1/live/calls", headers=agent)).status_code == 403
    field = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.post("/api/v1/live/presence", json={"status": "available"}, headers=field)).status_code == 403


async def test_dashboard_insights(client, admin, wards):
    await client.patch(f"/api/v1/geo/wards/{wards['Tudor'].id}", json={"target": 10}, headers=admin)
    await client.post("/api/v1/voters", json=voter_payload(wards["Tudor"]), headers=admin)
    ins = (await client.get("/api/v1/dashboard/summary", headers=admin)).json()["insights"]
    assert ins["today"] == 1 and len(ins["hourly"]) == 24 and sum(ins["hourly"]) == 1
    assert ins["cards"] and all(c["tone"] in {"good", "warn", "bad", "info"} for c in ins["cards"])
    assert {c["status"] for c in ins["constituencies"]} <= {"on_track", "at_risk", "critical", "unknown"}
