"""Encrypted file storage (AES-256-GCM): call recordings and staff photos.

The key is derived from PII_KEY with HKDF (separate "recordings" context), so
there's no extra secret to manage and it rotates with the PII key policy.
Layout on disk: 12-byte nonce || ciphertext+tag. Filenames are random."""
import base64
import hashlib
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings


# Each kind of file gets its own folder and its own derived key.
NAMESPACES = {"recordings": b"call-recordings", "photos": b"staff-photos", "visit-photos": b"visit-photos"}


def _key(ns: str) -> bytes:
    raw = base64.urlsafe_b64decode(settings.pii_key.encode())
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"campaign-hq", info=NAMESPACES[ns]).derive(raw)


def _root(ns: str = "recordings") -> Path:
    base = Path(settings.recordings_dir).resolve()
    root = base if ns == "recordings" else base.parent / ns
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    return root


def store(data: bytes, ns: str = "recordings") -> tuple[str, str]:
    """Encrypts and writes; returns (relative path, sha256 of the plaintext)."""
    digest = hashlib.sha256(data).hexdigest()
    nonce = os.urandom(12)
    blob = nonce + AESGCM(_key(ns)).encrypt(nonce, data, digest.encode())
    name = f"{secrets.token_hex(16)}.enc"
    path = _root(ns) / name
    with open(path, "wb") as f:
        f.write(blob)
    os.chmod(path, 0o600)
    return name, digest


def load(name: str, sha256: str, ns: str = "recordings") -> bytes:
    root = _root(ns)
    path = (root / name).resolve()
    if path.parent != root:  # never follow a stored path outside the vault
        raise FileNotFoundError(name)
    blob = path.read_bytes()
    return AESGCM(_key(ns)).decrypt(blob[:12], blob[12:], sha256.encode())  # raises if tampered


def delete(name: str, ns: str = "recordings") -> None:
    root = _root(ns)
    path = (root / name).resolve()
    if path.parent == root and path.exists():
        path.unlink()
