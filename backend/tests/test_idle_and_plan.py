from datetime import timedelta

from sqlalchemy import update

from app.core.clock import TZ, utcnow
from app.core.db import SessionLocal
from app.modules.users.models import UserSession
from tests.conftest import make_user, voter_payload


async def _age_sessions(minutes: int):
    async with SessionLocal() as s:
        await s.execute(update(UserSession).values(active_at=utcnow() - timedelta(minutes=minutes)))
        await s.commit()


async def test_idle_session_is_signed_out_but_activity_keeps_it(client, admin, wards):
    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    me = (await client.get("/api/v1/auth/me", headers=agent)).json()
    assert me["idle_minutes"] == 15 and me["portal"] == "field"
    await _age_sessions(10)
    assert (await client.post("/api/v1/auth/activity", headers=agent)).status_code == 204  # still inside 15 min: renewed
    assert (await client.get("/api/v1/auth/me", headers=agent)).status_code == 200
    await _age_sessions(16)
    r = await client.get("/api/v1/auth/me", headers=agent)
    assert r.status_code == 401 and "inactivity" in r.json()["detail"]
    assert (await client.post("/api/v1/auth/activity", headers=agent)).status_code == 401  # stays signed out


async def test_campaign_plan_tracks_actuals_and_planned_by_today(client, admin, wards):
    today = utcnow().astimezone(TZ).date()
    this_monday = today - timedelta(days=today.weekday())
    weeks = [{"week_start": (this_monday + timedelta(weeks=i)).isoformat(), "target": 70} for i in range(4)]
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="60000001"))
    p = (await client.put("/api/v1/election/plan", json={"weeks": weeks}, headers=admin)).json()
    assert len(p["weeks"]) == 4 and p["weeks"][0]["current"] and p["weeks"][0]["actual"] == 1
    assert p["weeks"][1]["actual"] is None and p["planned_total"] == 280
    assert p["planned_by_today"] == round(70 * (today.weekday() + 1) / 7) and p["vs_plan"] == 1 - p["planned_by_today"]
    bad = [{"week_start": (this_monday + timedelta(days=1)).isoformat(), "target": 5}]
    assert (await client.put("/api/v1/election/plan", json={"weeks": bad}, headers=admin)).status_code == 422
    coord = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    assert (await client.put("/api/v1/election/plan", json={"weeks": weeks}, headers=coord)).status_code == 403
    assert (await client.get("/api/v1/election/plan", headers=coord)).status_code == 200
