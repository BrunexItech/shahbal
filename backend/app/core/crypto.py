"""Field-level protection for national ID numbers (Data Protection Act 2019).

Stored three ways, each for one job:
  - ciphertext (Fernet)  -> reveal to authorised admins only, audited
  - keyed HMAC           -> dedup / exact lookup without decrypting
  - last 4 digits        -> masked display for everyone else
"""
import hashlib
import hmac

from cryptography.fernet import Fernet

from app.core.config import settings

_fernet = Fernet(settings.pii_key.encode())


def normalize_id(value: str) -> str:
    return "".join(ch for ch in value if ch.isalnum()).upper()


def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()


def blind_index(value: str) -> str:
    return hmac.new(settings.pii_pepper.encode(), normalize_id(value).encode(), hashlib.sha256).hexdigest()


def mask(last4: str | None) -> str:
    return f"••••{last4}" if last4 else "—"
