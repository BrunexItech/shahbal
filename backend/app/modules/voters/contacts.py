"""HQ contact lists: supporters' names and numbers for one ward or constituency, as an encrypted file.

The most sensitive download in the platform, so it is guarded at every step:
- HQ administrators only, and only right after "Confirm it's you" (step-up);
- a stated purpose, a per-person hourly limit, and an audit entry (who, what area, how many, why);
- never ID numbers, and never people who opted out or asked not to be called;
- the CSV travels inside an AES-256 encrypted ZIP whose password is shown once and never stored;
- the file itself is marked confidential with who exported it, when and why.
"""
import base64
import csv
import io
import secrets
from datetime import datetime

import pyzipper
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.core import audit
from app.core.clock import TZ, utcnow
from app.core.deps import Ctx
from app.core.ratelimit import RateLimiter
from app.modules.geo.models import Constituency, PollingStation, Ward
from app.modules.voters.models import Status, Support, Voter

_limit = RateLimiter(limit=10, window_seconds=3600)
MAX_ROWS = 100_000
SUPPORT_LABEL = {Support.supporter: "Supporter", Support.leaning: "Leaning", Support.undecided: "Undecided",
                 Support.opposed: "Opposed", Support.unknown: "Not asked yet"}
# No look-alike characters (0/O, 1/l/I), so the password can be read out or typed without mistakes.
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


class ContactsExportIn(BaseModel):
    constituency_id: str | None = None
    ward_id: str | None = None
    support: list[Support] = Field(default_factory=list)  # empty = everyone
    verified_only: bool = False
    purpose: str = Field(min_length=10, max_length=300)

    @model_validator(mode="after")
    def _one_area(self):
        if bool(self.constituency_id) == bool(self.ward_id):
            raise ValueError("Choose one constituency or one ward")
        return self


def _password() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(16))
    return "-".join(raw[i:i + 4] for i in range(0, 16, 4))


def _phone(e164: str) -> str:
    """0712 345 678: spreadsheets keep it as text (the leading 0 stays) and it can't be read as a formula."""
    local = "0" + e164[4:] if e164.startswith("+254") else e164
    return f"{local[:4]} {local[4:7]} {local[7:]}".strip() if len(local) == 10 else local


def _cell(v: str) -> str:
    return f"'{v}" if v[:1] in "=+-@\t\r" else v  # defuse spreadsheet formulas in names typed by people


async def export_contacts(ctx: Ctx, data: ContactsExportIn) -> dict:
    _limit.hit(ctx.user.id)
    s = ctx.session
    if data.ward_id:
        ward = await s.get(Ward, data.ward_id)
        if ward is None:
            raise HTTPException(422, "Choose a ward in Mombasa")
        area = f"{ward.name} ward"
        where = [Voter.ward_id == ward.id]
    else:
        cons = await s.get(Constituency, data.constituency_id)
        if cons is None:
            raise HTTPException(422, "Choose a constituency in Mombasa")
        area = f"{cons.name} constituency"
        where = [Voter.ward_id.in_(select(Ward.id).where(Ward.constituency_id == cons.id))]
    where += [Voter.opted_out.is_(False), Voter.do_not_call.is_(False), Voter.status != Status.rejected]
    if data.verified_only:
        where.append(Voter.status == Status.verified)
    if data.support:
        where.append(Voter.support.in_(data.support))
    rows = (await s.execute(
        select(Voter.reference, Voter.full_name, Voter.phone, Ward.name, Constituency.name, PollingStation.name,
               Voter.support, Voter.status, Voter.created_at)
        .join(Ward, Ward.id == Voter.ward_id).join(Constituency, Constituency.id == Ward.constituency_id)
        .outerjoin(PollingStation, PollingStation.id == Voter.station_id)
        .where(*where).order_by(Constituency.name, Ward.name, Voter.full_name).limit(MAX_ROWS + 1)
    )).all()
    if not rows:
        raise HTTPException(404, "Nobody matches those choices in that area")
    if len(rows) > MAX_ROWS:
        raise HTTPException(422, f"That's more than {MAX_ROWS:,} people. Choose a smaller area or add a filter.")

    now = utcnow().astimezone(TZ)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"CONFIDENTIAL. Exported by {ctx.user.full_name} on {now:%d %b %Y %H:%M} EAT for: {data.purpose.strip()}. "
                "Personal data under the Data Protection Act, 2019: use only for this purpose, share with no one, delete when done."])
    w.writerow(["Reference", "Full name", "Phone", "Ward", "Constituency", "Polling centre", "Support", "Verified", "Captured on"])
    for ref, name, phone, ward_name, cons_name, station, support, status, created in rows:
        w.writerow([ref, _cell(name), _phone(phone), ward_name, cons_name, station or "", SUPPORT_LABEL[support],
                    "Yes" if status == Status.verified else "No", created.astimezone(TZ).strftime("%d %b %Y")])

    password = _password()
    slug = area.lower().replace(" ", "-")
    stamp = f"{now:%Y%m%d-%H%M}"
    out = io.BytesIO()
    with pyzipper.AESZipFile(out, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
        z.setpassword(password.encode())
        z.setencryption(pyzipper.WZ_AES, nbits=256)
        z.writestr(f"contacts-{slug}-{stamp}.csv", "﻿" + buf.getvalue())  # BOM: Excel reads names with accents correctly

    audit.record(s, actor_id=ctx.user.id, action="EXPORT_CONTACTS", entity="voters", entity_id=data.ward_id or data.constituency_id,
                 ip=ctx.ip, area=area, rows=len(rows), purpose=data.purpose.strip(),
                 support=[x.value for x in data.support] or "all", verified_only=data.verified_only)
    await s.commit()
    return {"filename": f"contacts-{slug}-{stamp}.zip", "file": base64.b64encode(out.getvalue()).decode(),
            "password": password, "rows": len(rows), "area": area, "exported_at": datetime.now(TZ).isoformat()}
