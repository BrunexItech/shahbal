"""HQ contact lists: the most sensitive download, guarded and encrypted."""
import base64
import csv
import io

import pyzipper

from app.core.db import SessionLocal
from app.modules.voters.models import Voter
from tests.conftest import ADMIN, login, make_user, voter_payload
from sqlalchemy import select


def _open(res: dict) -> list[list[str]]:
    with pyzipper.AESZipFile(io.BytesIO(base64.b64decode(res["file"]))) as z:
        z.setpassword(res["password"].encode())
        [name] = z.namelist()
        text = z.read(name).decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


async def test_contacts_export_is_hq_only_confirmed_encrypted_and_leaves_out_who_said_no(client, admin, wards):
    tudor, likoni = wards["Tudor"], wards["Likoni"]
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="40000001", phone="0712000001", support="supporter"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="40000002", phone="0712000002", support="undecided"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(tudor, national_id="40000003", phone="0712000003", support="supporter"))
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(likoni, national_id="40000004", phone="0712000004", support="supporter"))
    async with SessionLocal() as s:  # one Tudor voter asked not to be contacted; another has a hostile name from an import
        (await s.execute(select(Voter).where(Voter.phone == "+254712000003"))).scalar_one().opted_out = True
        (await s.execute(select(Voter).where(Voter.phone == "+254712000002"))).scalar_one().full_name = "=HYPERLINK(evil)"
        await s.commit()

    body = {"ward_id": tudor.id, "purpose": "Invite Tudor supporters to the town hall"}
    lead = await make_user(client, admin, "coordinator", constituency_id=tudor.constituency_id)
    assert (await client.post("/api/v1/voters/contacts-export", json=body, headers=lead)).status_code == 403
    fresh = await login(client, *ADMIN)  # signed in, but not confirmed just now
    assert (await client.post("/api/v1/voters/contacts-export", json=body, headers=fresh)).status_code == 428
    assert (await client.post("/api/v1/voters/contacts-export", json={**body, "purpose": "x"}, headers=admin)).status_code == 422
    assert (await client.post("/api/v1/voters/contacts-export", json={**body, "constituency_id": tudor.constituency_id}, headers=admin)).status_code == 422

    res = (await client.post("/api/v1/voters/contacts-export", json=body, headers=admin)).json()
    assert len(res["password"]) == 19 and res["rows"] == 2 and res["area"] == "Tudor ward"
    with pyzipper.AESZipFile(io.BytesIO(base64.b64decode(res["file"]))) as z:  # useless without the password
        try:
            z.read(z.namelist()[0])
            raise AssertionError("opened without a password")
        except RuntimeError:
            pass
    rows = _open(res)
    assert rows[0][0].startswith("CONFIDENTIAL. Exported by") and "Invite Tudor supporters" in rows[0][0]
    assert rows[1] == ["Reference", "Full name", "Phone", "Ward", "Constituency", "Polling centre", "Support", "Verified", "Captured on"]
    phones = {r[2] for r in rows[2:]}
    assert phones == {"0712 000 001", "0712 000 002"}  # the opted-out voter and Likoni are left out
    assert "'=HYPERLINK(evil)" in [r[1] for r in rows[2:]]  # formula defused
    assert not any("40000001" in c for r in rows for c in r)  # never ID numbers

    only = (await client.post("/api/v1/voters/contacts-export", json={**body, "support": ["supporter"]}, headers=admin)).json()
    assert [r[2] for r in _open(only)[2:]] == ["0712 000 001"]
    cons = (await client.post("/api/v1/voters/contacts-export", headers=admin,
                              json={"constituency_id": likoni.constituency_id, "purpose": "Likoni phone bank for Saturday"})).json()
    assert cons["rows"] == 1

    log = (await client.get("/api/v1/audit", headers=admin, params={"action": "EXPORT_CONTACTS"})).json()
    items = log["items"] if isinstance(log, dict) else log
    assert any(i.get("action") == "EXPORT_CONTACTS" for i in items)
