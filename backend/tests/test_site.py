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


# ---- communications role + media --------------------------------------------------------
def _jpeg_with_gps() -> bytes:
    import io

    from PIL import Image

    img = Image.new("RGB", (3000, 1500), (0, 107, 63))
    exif = Image.Exif()
    exif[0x8825] = {1: "S", 2: (4.0, 3.0, 0.0), 3: "E", 4: (39.0, 40.0, 0.0)}  # GPS position
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


async def test_communications_role_posts_news_with_media_and_nothing_else(client, admin, wards):
    comms = await make_user(client, admin, "communications")
    # Sealed off from campaign data: every "any staff" and scoped endpoint refuses.
    for path in ("/api/v1/voters", "/api/v1/geo/tree", "/api/v1/dashboard/summary", "/api/v1/issues", "/api/v1/visits",
                 "/api/v1/calls/queues", "/api/v1/site-admin/volunteers", "/api/v1/messaging/campaigns", "/api/v1/users"):
        assert (await client.get(path, headers=comms)).status_code == 403, path
    assert (await client.get("/api/v1/auth/me", headers=comms)).json()["role"] == "communications"

    # Photos: re-encoded to WebP, resized, location data gone.
    up = await client.post("/api/v1/site-admin/media", headers=comms, data={"caption": "Bamburi town hall"},
                           files={"file": ("hall.jpg", _jpeg_with_gps(), "image/jpeg")})
    assert up.status_code == 201, up.text
    photo = up.json()
    assert photo["kind"] == "image" and photo["width"] == 2000 and photo["has_thumb"]
    served = await client.get(f"/api/v1/site/media/{photo['id']}")
    assert served.headers["content-type"] == "image/webp" and b"Exif" not in served.content and b"GPS" not in served.content
    assert (await client.get(f"/api/v1/site/media/{photo['id']}?thumb=1")).status_code == 200

    # Videos: checked by signature, not by the name or the declared type.
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2048
    vid = (await client.post("/api/v1/site-admin/media", headers=comms, files={"file": ("clip.mp4", mp4, "video/mp4")})).json()
    assert vid["kind"] == "video" and vid["content_type"] == "video/mp4"
    fake = await client.post("/api/v1/site-admin/media", headers=comms, files={"file": ("x.mp4", b"<script>alert(1)</script>", "video/mp4")})
    assert fake.status_code == 422
    assert (await client.post("/api/v1/site-admin/media", headers=comms, files={"file": ("x.jpg", b"not an image", "image/jpeg")})).status_code == 422

    story = {"title": "Town hall in Bamburi", "summary": "Residents asked about water and jobs.", "published": True, "cover_id": photo["id"],
             "body": f"Hundreds came on Saturday.\n[[media:{photo['id']}]]\n[[media:{vid['id']}]]\n[[youtube:dQw4w9WgXcQ]]"}
    assert (await client.post("/api/v1/site-admin/news", json={**story, "cover_id": vid["id"]}, headers=comms)).status_code == 422
    p = (await client.post("/api/v1/site-admin/news", json=story, headers=comms)).json()
    live = (await client.get(f"/api/v1/site/news/{p['slug']}")).json()
    assert live["cover_id"] == photo["id"] and set(live["media"]) == {photo["id"], vid["id"]}
    assert (await client.get("/api/v1/site/news")).json()[0]["cover_id"] == photo["id"]

    # Deleting a photo removes the file and clears the cover.
    assert (await client.delete(f"/api/v1/site-admin/media/{photo['id']}", headers=comms)).status_code == 204
    assert (await client.get(f"/api/v1/site/media/{photo['id']}")).status_code == 404
    assert (await client.get(f"/api/v1/site/news/{p['slug']}")).json()["cover_id"] is None
    await client.delete(f"/api/v1/site-admin/media/{vid['id']}", headers=comms)

    # Field staff can't publish.
    lead = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    assert (await client.post("/api/v1/site-admin/media", headers=lead, files={"file": ("clip.mp4", mp4, "video/mp4")})).status_code == 403
