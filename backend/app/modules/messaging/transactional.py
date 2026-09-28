"""One-off system SMS (security alerts), outside campaigns: never subject to
audiences, approval or opt-out, and never containing personal voter data."""
import logging
import uuid
from typing import NamedTuple

from app.modules.messaging.models import Channel
from app.modules.messaging.providers import OutItem, get_provider

log = logging.getLogger("transactional")


class Sent(NamedTuple):
    ok: bool
    error: str | None = None
    provider_id: str | None = None  # matches the delivery report later
    delivered: bool = False  # practice mode on a dev machine only


async def send_system_sms(phone: str, text: str) -> Sent:
    """Sends one SMS now and says truthfully what happened, so callers can tell people the truth."""
    try:
        [result] = await get_provider(Channel.sms).send([OutItem(f"sys-{uuid.uuid4().hex[:10]}", phone, text)])
        if not result.ok:
            log.warning("system SMS to …%s failed: %s", phone[-3:], result.error)
        return Sent(result.ok, result.error, result.provider_id, bool(result.delivered))
    except Exception:  # an alert failing must never break sign-in
        log.exception("system SMS failed")
        return Sent(False, "The SMS service couldn't be reached")
