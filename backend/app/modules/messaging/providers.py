"""Delivery providers behind one interface. Adding a gateway = one class + one line
in `get_provider`; nothing else in the system knows which gateway is live."""
import logging
import uuid
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import settings
from app.modules.messaging.models import Channel

log = logging.getLogger("messaging")


@dataclass
class OutItem:
    message_id: str
    phone: str
    body: str


@dataclass
class Result:
    message_id: str
    ok: bool
    provider_id: str | None = None
    error: str | None = None
    cost: str | None = None
    delivered: bool = False  # sandbox confirms delivery immediately


class Provider(Protocol):
    async def send(self, items: list[OutItem]) -> list[Result]: ...


NOT_LIVE = "Messages aren't switched on for this server: set SMS_PROVIDER=mobilesasa in backend/.env and restart"


class SandboxProvider:
    """Development: nothing leaves the machine. Logs and marks delivered.
    On a live server it refuses instead, so nothing is ever reported as sent when it wasn't."""

    async def send(self, items: list[OutItem]) -> list[Result]:
        if settings.is_production and not settings.testing:
            log.error("messaging is in practice mode on a production server: %d message(s) not sent", len(items))
            return [Result(it.message_id, False, error=NOT_LIVE) for it in items]
        for it in items:
            log.info("SANDBOX → %s: %s", it.phone, it.body[:80])
        return [Result(it.message_id, True, f"sandbox-{uuid.uuid4().hex[:12]}", delivered=True) for it in items]


def sms_live() -> bool:
    """True when SMS really go out (a real provider is configured)."""
    return settings.sms_provider in ("mobilesasa", "africastalking")


class AfricasTalkingSms:
    """Africa's Talking bulk SMS. Identical bodies are batched into one API call."""

    def __init__(self):
        sandbox = settings.at_username == "sandbox"
        self.url = f"https://api.{'sandbox.' if sandbox else ''}africastalking.com/version1/messaging"

    async def send(self, items: list[OutItem]) -> list[Result]:
        by_body: dict[str, list[OutItem]] = {}
        for it in items:
            by_body.setdefault(it.body, []).append(it)
        results: list[Result] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for body, group in by_body.items():
                data = {"username": settings.at_username, "to": ",".join(i.phone for i in group), "message": body, "bulkSMSMode": "1", "enqueue": "1"}
                if settings.at_sender_id:
                    data["from"] = settings.at_sender_id
                try:
                    r = await client.post(self.url, data=data, headers={"apiKey": settings.at_api_key, "Accept": "application/json"})
                    r.raise_for_status()
                    recipients = {x["number"]: x for x in r.json()["SMSMessageData"]["Recipients"]}
                except Exception as exc:  # network / auth / parse: fail the batch, keep the worker alive
                    log.exception("Africa's Talking batch failed")
                    results += [Result(i.message_id, False, error=str(exc)[:200]) for i in group]
                    continue
                for i in group:
                    x = recipients.get(i.phone)
                    ok = bool(x) and x.get("status") in ("Success", "Sent", "Queued")
                    results.append(Result(i.message_id, ok, x.get("messageId") if x else None,
                                          None if ok else (x or {}).get("status", "No response for number"), (x or {}).get("cost")))
        return results


class MobileSasaSms:
    """Mobile Sasa bulk SMS (docs.mobilesasa.com). Every campaign message is personal
    ({first_name}, {ward}), so batches go to /v1/send/bulk-personalized, up to 500 per
    call. The whole batch shares one bulkId; delivery reports come back with that bulkId
    and the number, which is how they are matched to each message."""

    CHUNK = 500

    @staticmethod
    def _local(phone: str) -> str:
        return "0" + phone[4:] if phone.startswith("+254") else phone  # +254712… → 0712…

    async def send(self, items: list[OutItem]) -> list[Result]:
        url = f"{settings.mobilesasa_base_url.rstrip('/')}/v1/send/bulk-personalized"
        headers = {"Authorization": f"Bearer {settings.mobilesasa_token}", "Accept": "application/json"}
        results: list[Result] = []
        async with httpx.AsyncClient(timeout=45) as client:
            for i in range(0, len(items), self.CHUNK):
                chunk = items[i:i + self.CHUNK]
                payload = {"senderID": settings.mobilesasa_sender_id,
                           "messageBody": [{"phone": self._local(it.phone), "message": it.body} for it in chunk]}
                try:
                    r = await client.post(url, json=payload, headers=headers)
                    data = r.json() if r.content else {}
                except Exception as exc:  # network / bad JSON: fail the chunk, keep the worker alive
                    log.exception("Mobile Sasa batch failed")
                    results += [Result(it.message_id, False, error=f"Mobile Sasa unreachable: {exc}"[:200]) for it in chunk]
                    continue
                if r.status_code < 300 and data.get("status") is True:
                    bulk = str(data.get("bulkId") or data.get("messageId") or "")
                    results += [Result(it.message_id, True, bulk or None) for it in chunk]
                else:
                    code = str(data.get("responseCode") or r.status_code)
                    reason = {"0401": "Mobile Sasa token is missing or wrong", "0402": "Mobile Sasa balance is too low for this batch",
                              "0403": "Mobile Sasa token lacks permission to send"}.get(code, str(data.get("message") or f"HTTP {r.status_code}"))
                    log.warning("Mobile Sasa refused a batch: %s %s", code, reason)
                    results += [Result(it.message_id, False, error=f"{reason} ({code})"[:200]) for it in chunk]
        return results


async def mobilesasa_balance() -> int | None:
    """SMS units left on the Mobile Sasa account (None if unavailable)."""
    if not settings.mobilesasa_token:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{settings.mobilesasa_base_url.rstrip('/')}/v1/get-balance/",
                                 headers={"Authorization": f"Bearer {settings.mobilesasa_token}"})
            data = r.json()
        return int(data["balance"]) if data.get("status") else None
    except Exception:
        return None


class WhatsAppCloud:
    """Meta WhatsApp Cloud API. Business-initiated messages must use a pre-approved
    template; the rendered text fills the template's single body variable."""

    async def send(self, items: list[OutItem]) -> list[Result]:
        url = f"https://graph.facebook.com/v21.0/{settings.wa_phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {settings.wa_access_token}"}
        results = []
        async with httpx.AsyncClient(timeout=30) as client:
            for it in items:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": it.phone.lstrip("+"),
                    "type": "template",
                    "template": {
                        "name": settings.wa_template,
                        "language": {"code": settings.wa_template_lang},
                        "components": [{"type": "body", "parameters": [{"type": "text", "text": it.body[:1000]}]}],
                    },
                }
                try:
                    r = await client.post(url, json=payload, headers=headers)
                    data = r.json()
                    if r.status_code >= 400:
                        results.append(Result(it.message_id, False, error=str(data.get("error", {}).get("message", r.status_code))[:200]))
                    else:
                        results.append(Result(it.message_id, True, data["messages"][0]["id"]))
                except Exception as exc:
                    results.append(Result(it.message_id, False, error=str(exc)[:200]))
        return results


def get_provider(channel: Channel) -> Provider:
    if channel == Channel.sms:
        if settings.sms_provider == "mobilesasa":
            return MobileSasaSms()
        return AfricasTalkingSms() if settings.sms_provider == "africastalking" else SandboxProvider()
    return WhatsAppCloud() if settings.whatsapp_provider == "cloud" else SandboxProvider()
