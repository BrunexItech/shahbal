"""One-off system SMS (security alerts), outside campaigns: never subject to
audiences, approval or opt-out, and never containing personal voter data."""
import logging
import uuid

from app.modules.messaging.models import Channel
from app.modules.messaging.providers import OutItem, get_provider

log = logging.getLogger("transactional")


async def send_system_sms(phone: str, text: str) -> tuple[bool, str | None]:
    """Sends one SMS now. Returns (sent, reason it wasn't) so callers can tell people the truth."""
    try:
        [result] = await get_provider(Channel.sms).send([OutItem(f"sys-{uuid.uuid4().hex[:10]}", phone, text)])
        if not result.ok:
            log.warning("system SMS to …%s failed: %s", phone[-3:], result.error)
        return result.ok, result.error
    except Exception:  # an alert failing must never break sign-in
        log.exception("system SMS failed")
        return False, "The SMS service couldn't be reached"
