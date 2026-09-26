"""Public website: HQ-edited pages and news, published events only, volunteer sign-ups."""
from datetime import timedelta

from app.core.clock import utcnow
from tests.conftest import make_user


async def test_pages_and_news(client, admin, wards):
    assert (await client.get("/api/v1/site/pages/about")).json()["body"] == ""
    assert (await client.get("/api/v1/site/pages/secret")).status_code == 404
    lead = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    body = {"title": "About Suleiman Shahbal", "body": "## Who he is\n- A son of Mombasa."}
    assert (await client.put("/api/v1/site-admin/pages/about", json=body, headers=lead)).status_code == 403
    assert (await client.put("/api/v1/site-admin/pages/about", json=body, headers=admin)).json()["body"].startswith("## Who")
    assert (await client.get("/api/v1/site/pages/about")).json()["title"] == "About Suleiman Shahbal"

    draft = {"title": "Town hall in Kisauni", "summary": "Residents asked about water and jobs.", "body": "Hundreds came to Bamburi grounds on Saturday."}
    p = (await client.post("/api/v1/site-admin/news", json=draft, headers=admin)).json()
    assert p["slug"] == "town-hall-in-kisauni" and not p["published"]
    assert (await client.get("/api/v1/site/news")).json() == []  # drafts stay private
    assert (await client.get(f"/api/v1/site/news/{p['slug']}")).status_code == 404
    await client.put(f"/api/v1/site-admin/news/{p['id']}", json={**draft, "published": True}, headers=admin)
    live = (await client.get("/api/v1/site/news")).json()
    assert [x["slug"] for x in live] == ["town-hall-in-kisauni"] and "body" not in live[0]
    assert (await client.get("/api/v1/site/news/town-hall-in-kisauni")).json()["body"].startswith("Hundreds")
    second = (await client.post("/api/v1/site-admin/news", json=draft, headers=admin)).json()
    assert second["slug"] == "town-hall-in-kisauni-2"


async def test_only_published_events_are_public(client, admin, wards):
    when = (utcnow() + timedelta(days=2)).isoformat()
    base = {"ward_id": wards["Tudor"].id, "venue": "Tudor grounds", "scheduled_at": when, "announce": False, "kind": "rally"}
    await client.post("/api/v1/visits", json={**base, "title": "Public rally", "public": True}, headers=admin)
    await client.post("/api/v1/visits", json={**base, "title": "Team walk"}, headers=admin)
    ev = (await client.get("/api/v1/site/events")).json()
    assert [e["title"] for e in ev] == ["Public rally"] and ev[0]["ward"] == "Tudor" and "lead" not in ev[0]


async def test_volunteer_sign_up_and_follow_up(client, admin, wards):
    body = {"full_name": "baraka  otieno", "phone": "0712345000", "ward_id": wards["Tudor"].id, "skills": ["canvassing", "hacking"],
            "availability": "weekends", "consent": True}
    assert (await client.post("/api/v1/site/volunteers", json={**body, "consent": False})).status_code == 422
    assert (await client.post("/api/v1/site/volunteers", json=body)).status_code == 201
    assert (await client.post("/api/v1/site/volunteers", json=body)).status_code == 201  # repeat: no duplicate
    lead = await make_user(client, admin, "ward_coordinator", ward=wards["Tudor"])
    far = await make_user(client, admin, "ward_coordinator", ward=wards["Likoni"], email="far@campaign.co.ke")
    got = (await client.get("/api/v1/site-admin/volunteers", headers=lead)).json()
    assert len(got["items"]) == 1 and got["items"][0]["full_name"] == "Baraka Otieno" and got["items"][0]["skills"] == ["canvassing"]
    assert (await client.get("/api/v1/site-admin/volunteers", headers=far)).json()["items"] == []
    vid = got["items"][0]["id"]
    assert (await client.patch(f"/api/v1/site-admin/volunteers/{vid}", json={"status": "contacted"}, headers=far)).status_code == 404
    await client.patch(f"/api/v1/site-admin/volunteers/{vid}", json={"status": "onboarded", "note": "Joined Saturday walks"}, headers=lead)
    assert (await client.get("/api/v1/site-admin/volunteers", headers=lead)).json()["counts"] == {"onboarded": 1}
