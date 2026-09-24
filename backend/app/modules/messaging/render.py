"""Message templating. Only whitelisted placeholders render — no format-string
injection, no attribute access."""
import re

PLACEHOLDERS = ("first_name", "name", "ward", "constituency", "station")
_RX = re.compile(r"\{(\w+)\}")
GSM7 = set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
SMS_FOOTER = "\nReply STOP to opt out."


def unknown_placeholders(body: str) -> list[str]:
    return sorted({m for m in _RX.findall(body) if m not in PLACEHOLDERS})


def render(body: str, ctx: dict[str, str]) -> str:
    return _RX.sub(lambda m: ctx.get(m.group(1), m.group(0)), body)


def voter_context(full_name: str, ward: str | None, constituency: str | None, station: str | None) -> dict[str, str]:
    return {
        "first_name": full_name.split()[0],
        "name": full_name,
        "ward": ward or "",
        "constituency": constituency or "",
        "station": station or "your polling station",
    }


def sms_segments(text: str) -> int:
    """GSM-7 fits 160 (153 per part); anything else (e.g. emoji) falls to UCS-2 at 70 (67)."""
    gsm = all(ch in GSM7 for ch in text)
    single, multi = (160, 153) if gsm else (70, 67)
    n = len(text)
    return 1 if n <= single else -(-n // multi)
