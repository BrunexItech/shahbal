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


async def test_agenda_items_and_media_names(client, admin, wards):
    comms = await make_user(client, admin, "communications")
    up = (await client.post("/api/v1/site-admin/media", headers=comms,
                            files={"file": ("Likoni_ferry-launch.jpg", _jpeg_with_gps(), "image/jpeg")})).json()
    assert up["label"] == "Likoni ferry launch"  # named from the file until HQ renames it
    renamed = (await client.patch(f"/api/v1/site-admin/media/{up['id']}", json={"label": "Ferry launch, June", "caption": "At the Likoni channel"},
                                  headers=comms)).json()
    assert renamed["label"] == "Ferry launch, June" and renamed["caption"] == "At the Likoni channel"
    assert [m["id"] for m in (await client.get("/api/v1/site-admin/media?q=ferry", headers=comms)).json()] == [up["id"]]
    assert (await client.get("/api/v1/site-admin/media?q=rally", headers=comms)).json() == []

    water = (await client.post("/api/v1/site-admin/agenda", headers=comms, json={
        "title": "Water every day", "summary": "Piped water to every ward within the first term.",
        "body": f"Our plan.\n[[media:{up['id']}]]", "cover_id": up["id"]})).json()
    jobs = (await client.post("/api/v1/site-admin/agenda", headers=comms, json={
        "title": "Jobs at the port", "summary": "Local hiring first for port and county jobs.", "published": False})).json()
    public = (await client.get("/api/v1/site/agenda")).json()
    assert [a["title"] for a in public] == ["Water every day"]  # drafts stay private
    assert "label" not in public[0]["media"][up["id"]]  # HQ's file names never reach the public
    assert (await client.post("/api/v1/site-admin/agenda/order", json={"ids": [jobs["id"]]}, headers=comms)).status_code == 422
    await client.post("/api/v1/site-admin/agenda/order", json={"ids": [jobs["id"], water["id"]]}, headers=comms)
    await client.put(f"/api/v1/site-admin/agenda/{jobs['id']}", headers=comms, json={**{k: jobs[k] for k in ("title", "summary", "body")}, "published": True})
    assert [a["title"] for a in (await client.get("/api/v1/site/agenda")).json()] == ["Jobs at the port", "Water every day"]
    assert (await client.delete(f"/api/v1/site-admin/agenda/{jobs['id']}", headers=comms)).status_code == 204
    assert [a["title"] for a in (await client.get("/api/v1/site/agenda")).json()] == ["Water every day"]
    lead = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    assert (await client.delete(f"/api/v1/site-admin/agenda/{water['id']}", headers=lead)).status_code == 403
    await client.delete(f"/api/v1/site-admin/media/{up['id']}", headers=comms)


def _real_mp4(seconds: int = 3) -> bytes:
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("ffmpeg"):
        return b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2048
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x180:rate=15",
                        "-pix_fmt", "yuv420p", f.name], check=True)
        return open(f.name, "rb").read()


async def test_videos_page_newest_first_with_topics_search_and_paging(client, admin, wards):
    import shutil

    comms = await make_user(client, admin, "communications")
    up = (await client.post("/api/v1/site-admin/media", headers=comms, files={"file": ("Likoni rally.mp4", _real_mp4(), "video/mp4")})).json()
    if shutil.which("ffmpeg"):
        assert up["duration"] == 3 and up["has_thumb"]  # length and a preview picture, made on upload
        assert (await client.get(f"/api/v1/site/media/{up['id']}?thumb=1")).headers["content-type"] == "image/webp"

    base = {"title": "Rally at Likoni", "topic": "rallies", "media_id": up["id"]}
    assert (await client.post("/api/v1/site-admin/videos", json={**base, "youtube": "dQw4w9WgXcQ"}, headers=comms)).status_code == 422
    assert (await client.post("/api/v1/site-admin/videos", json={**base, "topic": "gossip"}, headers=comms)).status_code == 422
    first = (await client.post("/api/v1/site-admin/videos", json=base, headers=comms)).json()
    yt = (await client.post("/api/v1/site-admin/videos", headers=comms, json={
        "title": "Interview on Radio Salaam", "topic": "interviews", "description": "Water and jobs", "youtube": "https://youtu.be/dQw4w9WgXcQ"})).json()
    assert yt["youtube_id"] == "dQw4w9WgXcQ"
    assert (await client.post("/api/v1/site-admin/videos", headers=comms, json={"title": "Bad link", "youtube": "https://vimeo.com/1"})).status_code == 422
    await client.post("/api/v1/site-admin/videos", headers=comms, json={"title": "Draft town hall", "topic": "town_halls", "youtube": "abcdefghijk", "published": False})

    page = (await client.get("/api/v1/site/videos")).json()
    assert [v["title"] for v in page["items"]] == ["Interview on Radio Salaam", "Rally at Likoni"]  # newest first, drafts hidden
    assert {t["id"]: t["count"] for t in page["topics"]} == {"rallies": 1, "interviews": 1}
    assert [v["title"] for v in (await client.get("/api/v1/site/videos?topic=rallies")).json()["items"]] == ["Rally at Likoni"]
    assert [v["title"] for v in (await client.get("/api/v1/site/videos?q=water")).json()["items"]] == ["Interview on Radio Salaam"]
    one = (await client.get("/api/v1/site/videos?size=1")).json()
    assert len(one["items"]) == 1 and one["more"] and not (await client.get("/api/v1/site/videos?size=1&page=2")).json()["more"]
    assert (await client.get(f"/api/v1/site/videos/{first['id']}")).json()["media_id"] == up["id"]

    # Re-publishing an older video brings it to the top.
    await client.put(f"/api/v1/site-admin/videos/{first['id']}", json={**base, "published": False}, headers=comms)
    await client.put(f"/api/v1/site-admin/videos/{first['id']}", json=base, headers=comms)
    assert (await client.get("/api/v1/site/videos")).json()["items"][0]["title"] == "Rally at Likoni"

    lead = await make_user(client, admin, "coordinator", constituency_id=wards["Tudor"].constituency_id)
    assert (await client.post("/api/v1/site-admin/videos", json=base, headers=lead)).status_code == 403
    assert (await client.delete(f"/api/v1/site-admin/videos/{yt['id']}", headers=comms)).status_code == 204
    # Deleting the file from the library takes its entry off the page too.
    await client.delete(f"/api/v1/site-admin/media/{up['id']}", headers=comms)
    assert (await client.get("/api/v1/site/videos")).json()["items"] == []
