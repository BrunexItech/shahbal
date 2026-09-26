"""The campaign calendar: a locked room that pulls every dated thing into one timeline."""
from datetime import timedelta

from app.core.clock import TZ, utcnow
from tests.conftest import elevate, login, make_user


def span(days_before=2, days_after=40):
    now = utcnow()
    return {"start": (now - timedelta(days=days_before)).isoformat(), "end": (now + timedelta(days=days_after)).isoformat()}


async def test_calendar_needs_a_fresh_identity_check_and_is_for_oversight_only(client, admin, wards):
    plain = await login(client, "admin@campaign.co.ke", "AdminPass!1")  # signed in, not re-confirmed
    assert (await client.get("/api/v1/calendar", params=span(), headers=plain)).status_code == 428
    assert (await client.get("/api/v1/calendar", params=span(), headers=admin)).status_code == 200
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    agent = await elevate(client, agent, "Password!1")
    assert (await client.get("/api/v1/calendar", params=span(), headers=agent)).status_code == 403
    assert (await client.get("/api/v1/calendar", params={"start": span()["start"], "end": span(0, 200)["end"]}, headers=admin)).status_code == 422


async def test_one_timeline_from_every_source(client, admin, wards):
    now = utcnow()
    today = now.astimezone(TZ).date()
    monday = today - timedelta(days=today.weekday())
    await client.put("/api/v1/election/settings", json={"election_date": (today + timedelta(days=20)).isoformat()}, headers=admin)
    await client.put("/api/v1/election/plan", json={"weeks": [{"week_start": monday.isoformat(), "target": 500}]}, headers=admin)
    rally = await client.post("/api/v1/visits", headers=admin, json={
        "title": "Tudor rally", "ward_id": wards["Tudor"].id, "venue": "Tudor grounds", "kind": "rally", "announce": False,
        "scheduled_at": (now + timedelta(days=3)).isoformat(), "ends_at": (now + timedelta(days=3, hours=3)).isoformat(),
        "expected_attendance": 2000})
    assert rally.status_code == 201, rally.text
    made = await client.post("/api/v1/calendar", headers=admin, json={
        "title": "Radio interview, Baraka FM", "kind": "media", "starts_at": (now + timedelta(days=1)).isoformat()})
    assert made.status_code == 201

    got = (await client.get("/api/v1/calendar", params=span(), headers=admin)).json()
    by = {e["source"]: e for e in got}
    assert {"event", "visit", "plan", "election"} <= set(by)
    assert by["visit"]["kind"] == "rally" and by["visit"]["expected_attendance"] == 2000 and by["visit"]["ends_at"]
    assert by["plan"]["target"] == 500 and by["plan"]["all_day"]
    assert by["event"]["can_edit"] is True


async def test_areas_hq_only_entries_and_repeating_series(client, admin, wards):
    now = utcnow()
    tudor, likoni = wards["Tudor"], wards["Likoni"]
    coord = await elevate(client, await make_user(client, admin, "coordinator", constituency_id=tudor.constituency_id), "Password!1")
    other = await elevate(client, await make_user(client, admin, "coordinator", constituency_id=likoni.constituency_id), "Password!1")
    viewer = await elevate(client, await make_user(client, admin, "viewer"), "Password!1")
    when = (now + timedelta(days=2)).isoformat()

    await client.post("/api/v1/calendar", headers=admin, json={"title": "Strategy session", "kind": "meeting", "starts_at": when, "hq_only": True})
    await client.post("/api/v1/calendar", headers=admin, json={"title": "County debate", "kind": "debate", "starts_at": when})
    r = await client.post("/api/v1/calendar", headers=coord, json={"title": "Mvita coordinators", "kind": "meeting", "starts_at": when,
                                                                   "constituency_id": tudor.constituency_id, "repeat_weeks": 3})
    assert r.status_code == 201 and len(r.json()) == 4 and len({e["series_id"] for e in r.json()}) == 1
    # Not in their area, and not allowed to make HQ-only entries.
    assert (await client.post("/api/v1/calendar", headers=coord, json={"title": "Likoni", "kind": "meeting", "starts_at": when,
                                                                       "ward_id": likoni.id})).status_code == 403
    assert (await client.post("/api/v1/calendar", headers=coord, json={"title": "Secret", "kind": "meeting", "starts_at": when,
                                                                       "constituency_id": tudor.constituency_id, "hq_only": True})).status_code == 403

    seen = {}
    for name, h in (("admin", admin), ("coord", coord), ("other", other), ("viewer", viewer)):
        rows = (await client.get("/api/v1/calendar", params=span(), headers=h)).json()
        seen[name] = {e["title"] for e in rows if e["source"] == "event"}
    assert seen["admin"] == {"Strategy session", "County debate", "Mvita coordinators"}
    assert seen["coord"] == {"County debate", "Mvita coordinators"}
    assert seen["other"] == {"County debate"}
    assert seen["viewer"] == {"County debate", "Mvita coordinators"}

    series = r.json()
    assert (await client.patch(f"/api/v1/calendar/{series[0]['id']}", json={"status": "done"}, headers=other)).status_code == 404
    assert (await client.delete(f"/api/v1/calendar/{series[1]['id']}", params={"series": True}, headers=coord)).json() == {"deleted": 3}
    left = [e for e in (await client.get("/api/v1/calendar", params=span(), headers=coord)).json() if e["title"] == "Mvita coordinators"]
    assert [e["id"] for e in left] == [series[0]["id"]]


async def test_gaps_are_wards_with_nothing_planned(client, admin, wards):
    await client.post("/api/v1/visits", headers=admin, json={
        "title": "Tudor walk", "ward_id": wards["Tudor"].id, "venue": "Market", "announce": False,
        "scheduled_at": (utcnow() + timedelta(days=4)).isoformat()})
    gaps = (await client.get("/api/v1/calendar/gaps", params={"days": 14}, headers=admin)).json()
    names = {g["ward"] for g in gaps}
    assert "Tudor" not in names and "Likoni" in names and len(names) == 29
