from sqlalchemy import select

from app.core.db import SessionLocal
from app.modules.voters.models import Voter


def body(ward, nid, phone, **kw):
    return {"full_name": "Zawadi Mwende", "phone": phone, "national_id": nid, "ward_id": ward.id, "consent": True, "birth_year": 1992, **kw}


async def test_share_codes_referrals_and_no_enumeration(client, admin, wards):
    a = await client.post("/api/v1/portal/signup", json=body(wards["Tudor"], "50000001", "0712500001"))
    assert a.status_code == 202
    code = a.json()["share_code"]
    assert code and len(code) == 8
    # Same phone again (duplicate ID) gets exactly the same answer: nothing leaks.
    again = await client.post("/api/v1/portal/signup", json=body(wards["Tudor"], "50000001", "0712500001"))
    assert again.json() == a.json()
    # A friend signs up through the invite link and is credited.
    b = await client.post("/api/v1/portal/signup", json=body(wards["Bamburi"], "50000002", "0712500002", ref=code))
    assert b.status_code == 202 and b.json()["share_code"] != code
    async with SessionLocal() as s:
        friend = (await s.execute(select(Voter).where(Voter.phone == "+254712500002"))).scalar_one()
        assert friend.referred_by == code
    sp = (await client.get("/api/v1/dashboard/supporters", headers=admin)).json()
    assert sp["referred"] == 1 and sp["recruiters"][0]["signups"] == 1 and sp["recruiters"][0]["ward"] == "Tudor"
    assert (await client.post("/api/v1/portal/signup", json=body(wards["Tudor"], "50000003", "0712500003", ref="bad!"))).status_code == 422
    qr = await client.get("/api/v1/portal/join-qr.svg", params={"ref": code})
    assert qr.status_code == 200 and qr.headers["content-type"].startswith("image/svg")


async def test_public_signup_requires_an_adult_year_of_birth(client, admin, wards):
    from datetime import datetime

    from app.core.clock import TZ

    year = datetime.now(TZ).year
    missing = body(wards["Tudor"], "51000001", "0712510001")
    missing.pop("birth_year")
    assert (await client.post("/api/v1/portal/signup", json=missing)).status_code == 422
    minor = await client.post("/api/v1/portal/signup", json=body(wards["Tudor"], "51000002", "0712510002", birth_year=year - 17))
    assert minor.status_code == 422 and "18 or older" in minor.text
    just = await client.post("/api/v1/portal/signup", json=body(wards["Tudor"], "51000003", "0712510003", birth_year=year - 18))
    assert just.status_code == 202
    # Same rule for staff captures
    r = await client.post("/api/v1/voters", headers=admin, json={"full_name": "Kid Test", "phone": "0712510004", "national_id": "51000004",
                                                                  "ward_id": wards["Tudor"].id, "consent": True, "birth_year": year - 10})
    assert r.status_code == 422
