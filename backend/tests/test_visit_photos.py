import io
from datetime import datetime, timedelta

from PIL import Image

from app.core.clock import TZ
from tests.conftest import make_user


def gps_jpeg() -> bytes:
    """A phone-style JPEG carrying a GPS position in its EXIF."""
    img = Image.new("RGB", (1200, 900), (0, 107, 63))
    exif = Image.Exif()
    exif[0x8825] = {1: "S", 2: (4.0, 3.0, 12.5), 3: "E", 4: (39.0, 40.0, 5.0)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


async def _visit(client, admin, ward, agent):
    when = (datetime.now(TZ) + timedelta(hours=1)).isoformat()
    v = (await client.post("/api/v1/visits", headers=admin, json={
        "title": "Market walk", "ward_id": ward.id, "venue": "Tudor market", "scheduled_at": when, "announce": False})).json()
    return v


async def test_visit_photos_lifecycle_privacy_and_scope(client, admin, wards):
    tudor = wards["Tudor"]
    agent = await make_user(client, admin, "field_agent", ward=tudor)
    v = await _visit(client, admin, tudor, agent)
    raw = gps_jpeg()

    # Not before check-in
    r = await client.post(f"/api/v1/visits/{v['id']}/photos", files={"photo": ("p.jpg", raw, "image/jpeg")}, headers=agent)
    assert r.status_code == 409
    await client.post(f"/api/v1/visits/{v['id']}/checkin", json={"latitude": -4.05, "longitude": 39.67}, headers=agent)

    r = await client.post(f"/api/v1/visits/{v['id']}/photos", files={"photo": ("p.jpg", raw, "image/jpeg")}, headers=agent)
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["taken_by"] and photo["width"] == 1200

    img = await client.get(photo["url"], headers=admin)
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert not Image.open(io.BytesIO(img.content)).getexif()  # GPS and all EXIF gone

    # Someone in another ward can't see it
    other = await make_user(client, admin, "field_agent", ward=wards["Bamburi"], email="other@campaign.co.ke")
    assert (await client.get(f"/api/v1/visits/{v['id']}/photos", headers=other)).status_code == 404
    assert (await client.get(photo["url"], headers=other)).status_code == 404

    # Garbage is refused
    bad = await client.post(f"/api/v1/visits/{v['id']}/photos", files={"photo": ("x.jpg", b"not an image", "image/jpeg")}, headers=agent)
    assert bad.status_code == 415

    # The overview's visited place advertises its photos
    places = (await client.get("/api/v1/map/overview", headers=admin)).json()["places"]
    assert places[0]["photos"] == 1 and places[0]["photo_url"] == photo["url"]

    # GIS Lab project: the visited place carries an absolute photo URL for the image popup
    proj = (await client.get("/api/v1/map/export/project.geolibre.json", headers=admin)).json()
    layers = {layer["id"]: layer for layer in proj["layers"]}
    place = layers["places"]["geojson"]["features"][0]["properties"]
    assert place["times_visited"] == 1 and place["photo"].endswith(photo["url"].removeprefix("/api/v1"))
    assert place["photo"].startswith("http") and any(f["kind"] == "image" for f in layers["places"]["popup"]["fields"])
    assert layers["timeline"]["geojson"]["features"][0]["properties"]["date"]

    # Only the taker or a manager can delete
    assert (await client.delete(photo["url"], headers=other)).status_code == 404
    assert (await client.delete(photo["url"], headers=agent)).status_code == 204
    assert (await client.get(f"/api/v1/visits/{v['id']}/photos", headers=admin)).json() == []
