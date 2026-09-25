import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.messaging import dispatcher
from app.modules.messaging.dispatcher import in_quiet_hours as real_quiet_hours
from app.modules.messaging.models import Message
from app.modules.voters.models import Voter
from tests.conftest import make_user, voter_payload

TZ = ZoneInfo("Africa/Nairobi")


async def seed_voters(client, admin, ward, n=3, prefix="3000", **kw):
    ids = []
    for i in range(n):
        r = await client.post("/api/v1/voters", json=voter_payload(ward, national_id=f"{prefix}{i:04d}", phone=f"07{prefix[:2]}{i:06d}", **kw), headers=admin)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return ids


async def run_dispatch(monkeypatch):
    monkeypatch.setattr(dispatcher, "in_quiet_hours", lambda now=None: False)
    while await dispatcher.dispatch_once(SessionLocal):
        pass


# ---- messaging ------------------------------------------------------------------
async def test_preview_counts_and_renders(client, admin, wards):
    await seed_voters(client, admin, wards["Tudor"], 3, support="supporter")
    await seed_voters(client, admin, wards["Bamburi"], 2, prefix="3100")
    r = (await client.post("/api/v1/messaging/preview", headers=admin, json={
        "body": "Habari {first_name} wa {ward}!", "audience": {"ward_ids": [wards["Tudor"].id]}})).json()
    assert r["recipients"] == 3 and r["sample"].startswith("Habari Amina wa Tudor!") and "STOP" in r["sample"]
    bad = (await client.post("/api/v1/messaging/preview", headers=admin, json={"body": "Hi {password}"})).json()
    assert bad["unknown_placeholders"] == ["password"]


async def test_admin_campaign_sends_skips_opted_out_and_never_duplicates(client, admin, wards, monkeypatch):
    ids = await seed_voters(client, admin, wards["Tudor"], 3)
    await client.patch(f"/api/v1/voters/{ids[0]}", json={"opted_out": True}, headers=admin)
    c = (await client.post("/api/v1/messaging/campaigns", headers=admin, json={
        "name": "Rally reminder", "body": "Karibu {first_name}", "audience": {"ward_ids": [wards["Tudor"].id]}})).json()
    assert c["status"] == "scheduled"  # admins are auto-approved
    await run_dispatch(monkeypatch)
    await run_dispatch(monkeypatch)  # second pass must not re-send
    done = (await client.get(f"/api/v1/messaging/campaigns/{c['id']}", headers=admin)).json()
    assert (done["status"], done["recipients"], done["delivered"]) == ("sent", 2, 2)
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count(Message.id)))).scalar_one() == 2
    st = (await client.get("/api/v1/messaging/stats", params={"days": 14}, headers=admin)).json()
    assert (st["total"], st["delivered"], st["failed"], st["opted_out"], st["campaigns"]) == (2, 2, 0, 1, 1)
    assert st["delivery_rate"] == 100.0 and st["by_channel"]["sms"]["delivered"] == 2 and st["series"][-1]["delivered"] == 2
    assert st["constituencies"] == [{"name": "Mvita", "total": 2, "delivered": 2, "failed": 0}]


async def test_coordinator_campaign_needs_approval_and_is_area_scoped(client, admin, wards, monkeypatch):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    await seed_voters(client, admin, tudor, 2)
    await seed_voters(client, admin, bamburi, 2, prefix="3200")
    coord = await make_user(client, admin, "coordinator", constituency_id=tudor.constituency_id)
    # Even asking for Bamburi explicitly, a Mvita coordinator only reaches Mvita voters.
    c = (await client.post("/api/v1/messaging/campaigns", headers=coord, json={
        "name": "Mvita push", "body": "Hello {first_name}", "audience": {}})).json()
    assert c["status"] == "pending_approval"
    await run_dispatch(monkeypatch)
    assert (await client.get(f"/api/v1/messaging/campaigns/{c['id']}", headers=coord)).json()["recipients"] == 0
    assert (await client.post(f"/api/v1/messaging/campaigns/{c['id']}/review", json={"approve": True}, headers=coord)).status_code == 403
    assert (await client.post(f"/api/v1/messaging/campaigns/{c['id']}/review", json={"approve": True}, headers=admin)).status_code == 200
    await run_dispatch(monkeypatch)
    assert (await client.get(f"/api/v1/messaging/campaigns/{c['id']}", headers=coord)).json()["recipients"] == 2
    agent = await make_user(client, admin, "field_agent", ward=tudor)
    assert (await client.post("/api/v1/messaging/preview", headers=agent, json={"body": "x"})).status_code == 403


async def test_quiet_hours_and_future_schedule_hold_messages(client, admin, wards, monkeypatch):
    await seed_voters(client, admin, wards["Tudor"], 1)
    later = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    c = (await client.post("/api/v1/messaging/campaigns", headers=admin, json={
        "name": "Later", "body": "Hi", "audience": {}, "scheduled_at": later})).json()
    await run_dispatch(monkeypatch)
    assert (await client.get(f"/api/v1/messaging/campaigns/{c['id']}", headers=admin)).json()["status"] == "scheduled"
    assert real_quiet_hours(datetime(2027, 8, 9, 22, 30, tzinfo=TZ))
    assert real_quiet_hours(datetime(2027, 8, 9, 6, 0, tzinfo=TZ))
    assert not real_quiet_hours(datetime(2027, 8, 9, 10, 0, tzinfo=TZ))
    assert not real_quiet_hours(datetime(2027, 8, 9, 20, 59, tzinfo=TZ))


async def test_stop_webhook_opts_out_and_requires_token(client, admin, wards):
    ids = await seed_voters(client, admin, wards["Tudor"], 1)
    phone = (await client.get(f"/api/v1/voters/{ids[0]}", headers=admin)).json()["phone"]
    bad = await client.post("/api/v1/messaging/webhooks/at/inbound?token=nope", data={"from": phone, "text": "STOP"})
    assert bad.status_code == 403
    ok = await client.post(f"/api/v1/messaging/webhooks/at/inbound?token={settings.webhook_secret}", data={"from": phone, "text": "stop please"})
    assert ok.status_code == 200
    assert (await client.get(f"/api/v1/voters/{ids[0]}", headers=admin)).json()["opted_out"] is True


# ---- visits ---------------------------------------------------------------------
async def test_visit_announcement_lifecycle(client, admin, wards, monkeypatch):
    await seed_voters(client, admin, wards["Tudor"], 2)
    when = (datetime.now(TZ) + timedelta(days=2)).replace(hour=15, minute=0, second=0, microsecond=0)
    v = (await client.post("/api/v1/visits", headers=admin, json={
        "title": "Tudor town hall", "ward_id": wards["Tudor"].id, "venue": "Tudor Social Hall", "scheduled_at": when.isoformat()})).json()
    assert v["announcement_campaign_id"] and v["status"] == "scheduled"
    c = (await client.get(f"/api/v1/messaging/campaigns/{v['announcement_campaign_id']}", headers=admin)).json()
    assert "Tudor Social Hall" in c["body"] and "3:00 PM" in c["body"] and c["kind"] == "visit"
    sched = datetime.fromisoformat(c["scheduled_at"].replace("Z", "+00:00"))
    assert abs((when - sched).total_seconds() - 24 * 3600) < 5  # announced 24h ahead
    cancelled = (await client.post(f"/api/v1/visits/{v['id']}/cancel", headers=admin)).json()
    assert cancelled["status"] == "cancelled" and cancelled["announcement_status"] == "cancelled"


async def test_visit_checkin_complete_and_scope(client, admin, wards):
    tudor, bamburi = wards["Tudor"], wards["Bamburi"]
    when = (datetime.now(TZ) + timedelta(hours=2)).isoformat()
    v = (await client.post("/api/v1/visits", headers=admin, json={
        "title": "Door to door", "ward_id": tudor.id, "venue": "Tudor estate", "scheduled_at": when, "announce": False})).json()
    other = await make_user(client, admin, "field_agent", ward=bamburi)
    assert (await client.post(f"/api/v1/visits/{v['id']}/checkin", json={}, headers=other)).status_code == 404
    agent = await make_user(client, admin, "field_agent", ward=tudor)
    r = await client.post(f"/api/v1/visits/{v['id']}/checkin", json={"latitude": -4.05, "longitude": 39.67}, headers=agent)
    assert r.json()["status"] == "in_progress"
    r = await client.post(f"/api/v1/visits/{v['id']}/complete", json={"attendance": 240, "outcome": "Great turnout"}, headers=agent)
    assert r.json()["status"] == "completed" and r.json()["attendance"] == 240
    wards_map = {w["name"]: w for w in (await client.get("/api/v1/map/overview", headers=admin)).json()["wards"]}
    assert wards_map["Tudor"]["visits_completed"] == 1 and wards_map["Bamburi"]["visits_completed"] == 0
    # A second visit ~20 m away counts as the same place, visited twice.
    v2 = (await client.post("/api/v1/visits", headers=admin, json={
        "title": "Follow-up", "ward_id": tudor.id, "venue": "Tudor estate", "scheduled_at": when, "announce": False})).json()
    await client.post(f"/api/v1/visits/{v2['id']}/checkin", json={"latitude": -4.0501, "longitude": 39.6701}, headers=agent)
    places = (await client.get("/api/v1/map/overview", headers=admin)).json()["places"]
    assert len(places) == 1 and places[0]["count"] == 2 and places[0]["exact"] and places[0]["attendance"] == 240
    past = (await client.post("/api/v1/visits", headers=admin, json={
        "title": "Past", "ward_id": tudor.id, "venue": "x1", "scheduled_at": "2020-01-01T10:00:00+03:00"}))
    assert past.status_code == 422


# ---- call centre ----------------------------------------------------------------
async def test_parallel_agents_never_get_same_voter(client, admin, wards):
    await seed_voters(client, admin, wards["Tudor"], 2)
    a1 = await make_user(client, admin, "call_agent", email="c1@campaign.co.ke")
    a2 = await make_user(client, admin, "call_agent", email="c2@campaign.co.ke")
    r1, r2 = await asyncio.gather(
        client.post("/api/v1/calls/next", json={"queue": "verify"}, headers=a1),
        client.post("/api/v1/calls/next", json={"queue": "verify"}, headers=a2),
    )
    assert r1.json()["voter"]["id"] != r2.json()["voter"]["id"]
    r3 = await client.post("/api/v1/calls/next", json={"queue": "verify"}, headers=admin)
    assert r3.status_code == 204  # both remaining voters are claimed


async def test_call_outcomes_update_voter(client, admin, wards):
    ids = await seed_voters(client, admin, wards["Tudor"], 3)
    agent = await make_user(client, admin, "call_agent", email="c3@campaign.co.ke")
    log = lambda vid, **kw: client.post("/api/v1/calls", json={"voter_id": vid, "queue": "verify", **kw}, headers=agent)  # noqa: E731
    r = await log(ids[0], outcome="answered", verify=True, support="supporter")
    assert r.status_code == 201
    v0 = (await client.get(f"/api/v1/voters/{ids[0]}", headers=admin)).json()
    assert v0["status"] == "verified" and v0["support"] == "supporter" and v0["last_contacted_at"]
    await log(ids[1], outcome="do_not_call")
    v1 = (await client.get(f"/api/v1/voters/{ids[1]}", headers=admin)).json()
    assert v1["do_not_call"] and v1["opted_out"]
    await log(ids[2], outcome="wrong_number")
    assert (await client.get(f"/api/v1/voters/{ids[2]}", headers=admin)).json()["status"] == "rejected"
    # nobody left to call today (cooldown + do-not-call + rejected)
    assert (await client.post("/api/v1/calls/next", json={"queue": "verify"}, headers=agent)).status_code == 204
    follow = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    await log(ids[0], outcome="call_back", follow_up_at=follow)
    assert (await client.get("/api/v1/calls/queues", headers=agent)).json()["follow_up"] == 1
    stats = (await client.get("/api/v1/calls/stats/today", headers=agent)).json()
    assert stats[0]["calls"] == 4 and stats[0]["answered"] == 1
    field = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.get("/api/v1/calls/queues", headers=field)).status_code == 403


# ---- election day ---------------------------------------------------------------
async def test_turnout_marking_and_gotv_reminders(client, admin, wards):
    ids = await seed_voters(client, admin, wards["Tudor"], 4, support="supporter")
    await seed_voters(client, admin, wards["Tudor"], 1, prefix="3900", support="opposed")
    for vid in ids[:3]:
        assert (await client.post(f"/api/v1/election/voters/{vid}/voted", json={"voted": True}, headers=admin)).status_code == 200
    t = (await client.get("/api/v1/election/turnout", params={"ward_id": wards["Tudor"].id}, headers=admin)).json()
    assert (t["overall"]["targets"], t["overall"]["voted"], t["overall"]["percent"]) == (4, 3, 75.0)
    assert t["last_hour"] == 3
    roster = (await client.get("/api/v1/election/roster", params={"ward_id": wards["Tudor"].id, "only_pending": True}, headers=admin)).json()
    assert [r["id"] for r in roster] == [ids[3]]

    assert (await client.post("/api/v1/election/reminders", json={}, headers=admin)).status_code == 422  # no date yet
    day = (datetime.now(TZ) + timedelta(days=10)).date().isoformat()
    s = (await client.put("/api/v1/election/settings", json={"election_date": day}, headers=admin)).json()
    assert s["days_to_go"] == 10
    first = (await client.post("/api/v1/election/reminders", json={}, headers=admin)).json()
    again = (await client.post("/api/v1/election/reminders", json={}, headers=admin)).json()
    assert len(first) == 4 and again == []
    push = [c for c in (await client.get("/api/v1/messaging/campaigns", headers=admin)).json() if c["name"] == "GOTV: afternoon push"][0]
    assert push["audience"]["voted"] is False and push["kind"] == "gotv"


# ---- map / GIS / exports --------------------------------------------------------
async def test_gis_exports_are_aggregate_and_suppress_small_cells(client, admin, wards):
    for i in range(6):
        await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id=f"4100{i:04d}",
                                                                              capture_lat=-4.0601, capture_lng=39.6701))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="41999999",
                                                                          capture_lat=-4.1501, capture_lng=39.6001))
    grid = (await client.get("/api/v1/map/export/grid.geojson", headers=admin)).json()
    assert len(grid["features"]) == 1 and grid["features"][0]["properties"]["captures"] == 6  # lone point suppressed
    w = (await client.get("/api/v1/map/export/wards.geojson", headers=admin)).json()
    assert len(w["features"]) == 30
    text = str(w)
    assert "Amina" not in text and "+2547" not in text
    b = await client.get("/api/v1/map/boundaries", headers=admin)
    assert b.headers["cache-control"].startswith("private") and len(b.json()["features"]) == 30
    c = (await client.get("/api/v1/map/boundaries/constituencies", headers=admin)).json()
    assert sorted(f["properties"]["name"] for f in c["features"]) == ["Changamwe", "Jomvu", "Kisauni", "Likoni", "Mvita", "Nyali"]
    assert sum(f["properties"]["wards"] for f in c["features"]) == 30
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.get("/api/v1/map/export/wards.geojson", headers=agent)).status_code == 403


async def test_area_breakdown_rolls_up_and_is_scoped(client, admin, wards):
    tudor = wards["Tudor"]
    await client.patch(f"/api/v1/geo/wards/{tudor.id}", json={"target": 10}, headers=admin)
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="30000001", support="supporter"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Bamburi"], national_id="30000002", phone="0712000002"))
    b = (await client.get("/api/v1/dashboard/breakdown", headers=admin)).json()
    assert b["county"]["captured"] == 2 and b["county"]["wards"] == 30 and len(b["constituencies"]) == 6
    mvita = next(c for c in b["constituencies"] if c["name"] == "Mvita")
    t = next(w for w in mvita["wards"] if w["name"] == "Tudor")
    assert (t["captured"], t["supporters"], t["today"], t["target"], t["gap"], t["percent"]) == (1, 1, 1, 10, 9, 10.0)
    assert t["no_station"] == 1 and mvita["captured"] == 1
    agent = await make_user(client, admin, "field_agent", ward=tudor)
    # Agents don't get campaign-wide overviews; they have their own workspace.
    for path in ("/api/v1/dashboard/breakdown", "/api/v1/dashboard/summary", "/api/v1/election/plan", "/api/v1/dashboard/trends"):
        assert (await client.get(path, headers=agent)).status_code == 403
    await client.post("/api/v1/voters", headers=agent, json=voter_payload(tudor, national_id="30000009", phone="0712000099"))
    area = (await client.get("/api/v1/dashboard/my-area", headers=agent)).json()
    assert area["ward"]["name"] == "Tudor" and area["ward"]["target"] == 10 and area["ward"]["captured"] == 2
    assert area["me"]["today"] == 1 and area["rank"]["position"] == 1 and area["recent"][0]["full_name"]
    assert (await client.get("/api/v1/dashboard/my-area", headers=admin)).status_code == 403


async def test_csv_export_masks_ids_and_defuses_formulas(client, admin, wards):
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="55554444"))
    async with SessionLocal() as s:  # simulate a hostile name slipping in from an import
        v = (await s.execute(select(Voter))).scalar_one()
        v.full_name = "=HYPERLINK(evil)"
        await s.commit()
    csv_text = (await client.get("/api/v1/map/export/voters.csv", headers=admin)).text
    assert "55554444" not in csv_text and "••••4444" in csv_text
    assert "'=HYPERLINK(evil)" in csv_text


# ---- offline sync + station seed -------------------------------------------------
async def test_offline_replay_is_idempotent(client, admin, wards):
    body = voter_payload(wards["Tudor"], client_ref="dev-7f3a9c1e-0001")
    a = await client.post("/api/v1/voters", json=body, headers=admin)
    b = await client.post("/api/v1/voters", json=body, headers=admin)  # retried after a dropped response
    assert a.status_code == b.status_code == 201 and a.json()["id"] == b.json()["id"]


async def test_bundled_station_seed_and_official_reimport(client, admin):
    from app.modules.geo.service import seed_stations

    async with SessionLocal() as s:
        first = await seed_stations(s)
        again = await seed_stations(s)
    assert first.created == 210 and again.created == 0 and again.updated == 210
    stations = (await client.get("/api/v1/geo/stations", headers=admin)).json()
    assert len(stations) == 210 and sum(1 for x in stations if x["latitude"] is not None) == 81
    # An official file with real IEBC codes updates the same stations instead of duplicating them.
    csv = "code,name,ward_code,registered_voters\n001001000101,BOMU PRIMARY SCHOOL,0001,4200\n"
    r = (await client.post("/api/v1/geo/stations/import", headers=admin, files={"file": ("iebc.csv", csv, "text/csv")})).json()
    assert r == {"created": 0, "updated": 1, "errors": []}
    bomu = [x for x in (await client.get("/api/v1/geo/stations", params={"q": "Bomu"}, headers=admin)).json()]
    assert len(bomu) == 1 and bomu[0]["code"] == "001001000101" and bomu[0]["registered_voters"] == 4200


async def test_gis_project_is_aggregate_and_admin_only(client, admin, wards):
    await client.patch(f"/api/v1/geo/wards/{wards['Tudor'].id}", json={"target": 100}, headers=admin)
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="61234567"))
    p = (await client.get("/api/v1/map/export/project.geolibre.json", headers=admin)).json()
    assert p["version"] == "0.1.0" and [l["id"] for l in p["layers"]] == ["constituencies", "progress", "density", "wards", "stations", "timeline", "places"]
    wl = p["layers"][1]
    assert wl["style"]["vectorStyleMode"] == "graduated" and wl["style"]["vectorStyleProperty"] == "percent"
    assert len(wl["geojson"]["features"]) == 30 and wl["capabilities"]["update"] is False
    assert "storymap" not in p  # workspace mode opens straight into analysis
    brief = (await client.get("/api/v1/map/export/project.geolibre.json", params={"mode": "briefing"}, headers=admin)).json()
    assert len(brief["storymap"]["chapters"]) == 7  # county + 6 constituencies
    text = str(p)
    assert "Amina" not in text and "+2547" not in text and "61234567" not in text
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.get("/api/v1/map/export/project.geolibre.json", headers=agent)).status_code == 403
    assert (await client.get("/api/v1/auth/gis-access", headers=admin)).status_code == 204
    assert (await client.get("/api/v1/auth/gis-access", headers=agent)).status_code == 403
    assert (await client.get("/api/v1/auth/gis-access")).status_code == 401


async def test_gis_one_time_link(client, admin, wards):
    from app.core.config import settings

    link = (await client.post("/api/v1/map/export/project-link", params={"mode": "briefing"}, headers=admin)).json()
    assert link["expires_in"] == 120
    client.cookies.clear()
    # The lab fetches it from its own origin, with no session cookie.
    r = await client.get(f"/api/v1{link['url']}", headers={"Origin": settings.gis_origin})
    assert r.status_code == 200 and r.json()["storymap"]["chapters"]
    layers = {layer["id"]: layer for layer in r.json()["layers"]}
    assert len(layers["constituencies"]["geojson"]["features"]) == 6
    assert layers["constituencies"]["style"]["vectorStyleMode"] == "categorized"
    assert r.headers["access-control-allow-origin"] == settings.gis_origin
    assert (await client.get(f"/api/v1{link['url']}")).status_code == 410  # single use
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    assert (await client.post("/api/v1/map/export/project-link", headers=agent)).status_code == 403
