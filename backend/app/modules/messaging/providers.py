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


class SandboxProvider:
    """Development: nothing leaves the machine. Logs and marks delivered."""

    async def send(self, items: list[OutItem]) -> list[Result]:
        for it in items:
            log.info("SANDBOX → %s: %s", it.phone, it.body[:80])
        return [Result(it.message_id, True, f"sandbox-{uuid.uuid4().hex[:12]}", delivered=True) for it in items]


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
        return AfricasTalkingSms() if settings.sms_provider == "africastalking" else SandboxProvider()
    return WhatsAppCloud() if settings.whatsapp_provider == "cloud" else SandboxProvider()
