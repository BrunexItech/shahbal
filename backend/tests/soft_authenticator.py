"""A software WebAuthn authenticator for tests: real P-256 keys, real CBOR
attestation objects and real signatures over real challenges, i.e. what a
phone's secure chip produces, minus the chip."""
import base64
import hashlib
import json
import os
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class SoftAuthenticator:
    def __init__(self, rp_id: str = "localhost", origin: str = "http://localhost:3000"):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(32)
        self.sign_count = 0
        self.rp_id = rp_id
        self.origin = origin
        self.user_handle: str | None = None

    def _cose_key(self) -> bytes:
        n = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})

    def _auth_data(self, attested: bool, uv: bool) -> bytes:
        flags = 0x01 | (0x04 if uv else 0) | (0x40 if attested else 0)  # UP | UV | AT
        data = hashlib.sha256(self.rp_id.encode()).digest() + bytes([flags]) + struct.pack(">I", self.sign_count)
        if attested:
            data += b"\x00" * 16 + struct.pack(">H", len(self.cred_id)) + self.cred_id + self._cose_key()
        return data

    def _client_data(self, typ: str, challenge: str, origin: str | None) -> bytes:
        return json.dumps({"type": typ, "challenge": challenge, "origin": origin or self.origin, "crossOrigin": False}).encode()

    def register(self, options: dict, *, origin: str | None = None, uv: bool = True) -> dict:
        self.user_handle = options["user"]["id"]
        cd = self._client_data("webauthn.create", options["challenge"], origin)
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": self._auth_data(True, uv)})
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(cd), "attestationObject": b64u(att), "transports": ["internal"]},
                "clientExtensionResults": {}, "authenticatorAttachment": "platform"}

    def sign(self, options: dict, *, origin: str | None = None, uv: bool = True, bump: bool = True) -> dict:
        if bump:
            self.sign_count += 1
        cd = self._client_data("webauthn.get", options["challenge"], origin)
        ad = self._auth_data(False, uv)
        sig = self.key.sign(ad + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(cd), "authenticatorData": b64u(ad), "signature": b64u(sig),
                             "userHandle": self.user_handle},
                "clientExtensionResults": {}, "authenticatorAttachment": "platform"}
