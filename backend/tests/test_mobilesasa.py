"""Mobile Sasa: batches go out as personalised bulk; signed delivery reports land on the right message.
The gateway is simulated here: nothing leaves the machine."""
import hashlib
import hmac
import json
import time

import httpx
from sqlalchemy import select

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.messaging import providers
from app.modules.messaging.models import CampaignStatus, Channel, Message, MessageCampaign, MessageStatus
from app.modules.messaging.providers import MobileSasaSms, OutItem
from app.modules.users.models import User
from app.modules.voters.models import Voter
from tests.conftest import voter_payload


class FakeClient:
    """Stands in for httpx.AsyncClient; records calls, answers like Mobile Sasa."""
    calls: list[dict] = []
    reply: dict = {"status": True, "responseCode": "0200", "message": "Accepted", "bulkId": "bulk-1"}

    def __init__(self, *a, **kw): ...
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False

    async def post(self, url, json=None, headers=None):
        FakeClient.calls.append({"url": url, "json": json, "headers": headers})
        return httpx.Response(200, json=FakeClient.reply)


async def test_batches_are_personalised_bulk_in_chunks(monkeypatch):
    monkeypatch.setattr(providers.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "mobilesasa_token", "mbs_test")
    monkeypatch.setattr(settings, "mobilesasa_sender_id", "SHAHBAL")
    FakeClient.calls = []
    items = [OutItem(f"m{i}", f"+2547{i:08d}", f"Habari {i}") for i in range(1100)]
    out = await MobileSasaSms().send(items)
    assert len(FakeClient.calls) == 3 and [len(c["json"]["messageBody"]) for c in FakeClient.calls] == [500, 500, 100]
    first = FakeClient.calls[0]
    assert first["url"].endswith("/v1/send/bulk-personalized") and first["headers"]["Authorization"] == "Bearer mbs_test"
    assert first["json"]["senderID"] == "SHAHBAL" and first["json"]["messageBody"][0] == {"phone": "0700000000", "message": "Habari 0"}
    assert all(r.ok and r.provider_id == "bulk-1" for r in out)

    FakeClient.reply = {"status": False, "responseCode": "0402", "message": "Insufficient balance"}
    out = await MobileSasaSms().send(items[:2])
    assert not out[0].ok and "balance is too low" in out[0].error
    FakeClient.reply = {"status": True, "responseCode": "0200", "message": "Accepted", "bulkId": "bulk-1"}


async def _message(wards, client, admin, phone: str) -> Message:
    await client.post("/api/v1/voters", headers=admin, json=voter_payload(wards["Tudor"], national_id="77000001", phone=phone))
    async with SessionLocal() as s:
        v = (await s.execute(select(Voter))).scalar_one()
        u = (await s.execute(select(User))).scalars().first()
        c = MessageCampaign(name="Test", channel=Channel.sms, body="Hi", audience={}, status=CampaignStatus.sent,
                            scheduled_at=utcnow(), created_by_id=u.id, recipients=1, sent=1)
        s.add(c)
        await s.flush()
        m = Message(campaign_id=c.id, voter_id=v.id, phone=v.phone, body="Hi", status=MessageStatus.sent, provider_id="bulk-9")
        s.add(m)
        await s.commit()
        return m


def _signed(body: bytes, secret: str, age: int = 0) -> dict:
    t = str(int(time.time()) - age)
    sig = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return {"X-MobileSasa-Signature": f"t={t},v1={sig}", "Content-Type": "application/json"}


async def test_signed_delivery_reports_update_the_right_message(client, admin, wards, monkeypatch):
    monkeypatch.setattr(settings, "mobilesasa_signing_secret", "sign-me")
    monkeypatch.setattr(settings, "mobilesasa_webhook_secret", "")
    m = await _message(wards, client, admin, "0712345678")
    url = "/api/v1/messaging/webhooks/mobilesasa/delivery"
    body = json.dumps({"status": "Delivered", "deliveryStatus": "DeliveredToTerminal", "reference": "bulk-9", "msisdn": "254712345678",
                       "cost": "0.20"}).encode()
    assert (await client.post(url, content=body, headers={"Content-Type": "application/json"})).status_code == 403  # unsigned
    assert (await client.post(url, content=body, headers=_signed(body, "wrong"))).status_code == 403
    assert (await client.post(url, content=body, headers=_signed(body, "sign-me", age=900))).status_code == 403  # replayed
    assert (await client.post(url, content=body, headers=_signed(body, "sign-me"))).status_code == 200
    async with SessionLocal() as s:
        got = await s.get(Message, m.id)
        camp = await s.get(MessageCampaign, got.campaign_id)
        assert got.status == MessageStatus.delivered and got.cost == "KES 0.20" and camp.delivered == 1

    # A late failure never undoes a confirmed delivery.
    fail = json.dumps({"status": "Failed", "deliveryStatus": "AbsentSubscriber", "reference": "bulk-9", "msisdn": "254712345678"}).encode()
    await client.post(url, content=fail, headers=_signed(fail, "sign-me"))
    async with SessionLocal() as s:
        assert (await s.get(Message, m.id)).status == MessageStatus.delivered


async def test_plain_webhook_secret_also_works(client, admin, wards, monkeypatch):
    monkeypatch.setattr(settings, "mobilesasa_signing_secret", "")
    monkeypatch.setattr(settings, "mobilesasa_webhook_secret", "plain-secret")
    m = await _message(wards, client, admin, "0712345678")
    body = json.dumps({"status": "Failed", "deliveryStatus": "AbsentSubscriber", "reference": "bulk-9", "msisdn": "254712345678"}).encode()
    r = await client.post("/api/v1/messaging/webhooks/mobilesasa/delivery", content=body,
                          headers={"X-MobileSasa-Secret": "plain-secret", "Content-Type": "application/json"})
    assert r.status_code == 200
    async with SessionLocal() as s:
        got = await s.get(Message, m.id)
        assert got.status == MessageStatus.failed and got.error == "AbsentSubscriber"
