"""Form 34A parallel tally: per-stream forms with photos, area rules, verification, totals."""
import json

import pytest

from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.geo.service import seed_stations
from tests.conftest import elevate, make_user, photo_bytes


@pytest.fixture(autouse=True)
def vault_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "recordings_dir", str(tmp_path / "vault"))


async def _station(client, headers, name):
    return next(x for x in (await client.get("/api/v1/geo/stations", params={"q": name}, headers=headers)).json() if x["name"] == name)


async def test_ballot_forms_and_tally(client, admin, wards):
    async with SessionLocal() as s:
        await seed_stations(s)
    ballot = {"candidates": [{"name": "Suleiman Shahbal", "party": "Our party", "ours": True, "color": "#006b3f"},
                             {"name": "Rival One", "party": "Other", "color": "#1a3a66"}]}
    assert (await client.put("/api/v1/election/candidates", json={"candidates": ballot["candidates"][1:]}, headers=admin)).status_code == 422
    cands = (await client.put("/api/v1/election/candidates", json=ballot, headers=admin)).json()
    ours, rival = cands[0]["id"], cands[1]["id"]

    agent = await make_user(client, admin, "field_agent", ward=wards["Tudor"])
    lead = await make_user(client, admin, "ward_coordinator", ward=wards["Tudor"])
    far = await make_user(client, admin, "field_agent", ward=wards["Likoni"])
    sparki = await _station(client, admin, "Sparki Primary School")
    photo = {"photo": ("34a.png", photo_bytes(), "image/png")}

    def form(stream, a, b, rejected=2):
        return {"station_id": sparki["id"], "stream_no": str(stream), "votes": json.dumps({ours: a, rival: b}), "rejected": str(rejected)}

    url = "/api/v1/election/results"
    assert (await client.post(url, data=form(1, 300, 200), headers=agent)).status_code == 422  # photo required
    assert (await client.post(url, data=form(1, 300, 200), files=photo, headers=far)).status_code == 403  # not their ward
    assert (await client.post(url, data=form(99, 300, 200), files=photo, headers=agent)).status_code == 422  # no such stream
    assert (await client.post(url, data=form(1, 900, 200), files=photo, headers=agent)).status_code == 422  # impossible total
    bad = {**form(1, 1, 1), "votes": json.dumps({ours: 1})}
    assert (await client.post(url, data=bad, files=photo, headers=agent)).status_code == 422  # every candidate
    r = await client.post(url, data=form(1, 300, 200), files=photo, headers=agent)
    assert r.status_code == 201
    await client.post(url, data=form(2, 150, 250), files=photo, headers=agent)
    # A corrected form replaces the first one (photo optional the second time).
    assert (await client.post(url, data=form(1, 310, 190), headers=agent)).status_code == 201

    t = (await client.get("/api/v1/election/results/tally", headers=admin)).json()
    assert t["totals"] == {ours: 460, rival: 440} and t["rejected"] == 4 and t["streams_reported"] == 2 and t["streams_total"] == 1041
    tudor = next(w for w in t["wards"] if w["name"] == "Tudor")
    assert tudor["reported"] == 2 and tudor["votes"][ours] == 460

    # The coordinator disputes one; it drops out of the tally, and the photo is there to check.
    mine = (await client.get(url, headers=agent)).json()
    assert len(mine) == 2 and (await client.get(mine[0]["photo_url"].replace("/api/v1", "/api/v1"), headers=lead)).status_code == 200
    s2 = next(f for f in mine if f["stream_no"] == 2)
    assert (await client.post(f"{url}/{s2['id']}/review", json={"status": "disputed"}, headers=lead)).status_code == 422  # needs a note
    await client.post(f"{url}/{s2['id']}/review", json={"status": "disputed", "note": "Photo shows 250 for Shahbal"}, headers=lead)
    s1 = next(f for f in mine if f["stream_no"] == 1)
    await client.post(f"{url}/{s1['id']}/review", json={"status": "verified"}, headers=lead)
    t = (await client.get("/api/v1/election/results/tally", headers=admin)).json()
    assert t["totals"] == {ours: 310, rival: 190} and t["forms"] == {"submitted": 0, "verified": 1, "disputed": 1}
    assert (await client.post(url, data=form(1, 1, 1), headers=agent)).status_code == 409  # verified: agents can't overwrite
    # The ballot is locked once results are in.
    assert (await client.put("/api/v1/election/candidates", json=ballot, headers=admin)).status_code == 409
    assert (await client.get("/api/v1/election/results/tally", headers=agent)).status_code == 403
