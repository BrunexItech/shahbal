"""Passkeys (WebAuthn) — fingerprint / face / device PIN, or a hardware security key.

Best-practice choices:
  * Challenges are random, server-stored, single-use and expire in 5 minutes.
  * User verification is REQUIRED: the device must check the biometric or PIN,
    so a passkey counts as a full second factor on its own.
  * Discoverable credentials (resident keys) enable sign-in without typing an email.
  * Sign counters are enforced by py_webauthn to catch cloned authenticators.
  * Attestation "none": we don't collect device-make data we don't need.
"""
import json
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse, WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    PublicKeyCredentialHint,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.clock import utcnow
from app.core.config import settings
from app.modules.auth.models import AuthChallenge, ChallengePurpose, Passkey
from app.modules.users.models import User

CHALLENGE_TTL = timedelta(minutes=5)
EXPIRED = "This request expired. Please try again."


def _descriptor(p: Passkey) -> PublicKeyCredentialDescriptor:
    transports = []
    for t in p.transports or []:
        try:
            transports.append(AuthenticatorTransport(t))
        except ValueError:
            pass
    return PublicKeyCredentialDescriptor(id=p.credential_id, transports=transports or None)


async def _new_challenge(session: AsyncSession, purpose: ChallengePurpose, challenge: bytes, user_id: str | None,
                         meta: dict | None = None) -> str:
    ch = AuthChallenge(purpose=purpose, challenge=challenge, user_id=user_id, meta=meta, expires_at=utcnow() + CHALLENGE_TTL)
    session.add(ch)
    await session.flush()
    return ch.id


async def consume_challenge(session: AsyncSession, flow_id: str, purpose: ChallengePurpose, user_id: str | None) -> AuthChallenge:
    """Single use: locked, checked and burned in the caller's transaction."""
    ch = (await session.execute(select(AuthChallenge).where(AuthChallenge.id == flow_id).with_for_update())).scalar_one_or_none()
    if ch is None or ch.used_at is not None or ch.expires_at <= utcnow() or ch.purpose != purpose or ch.user_id != user_id:
        raise HTTPException(400, EXPIRED)
    ch.used_at = utcnow()
    return ch


async def user_passkeys(session: AsyncSession, user_id: str) -> list[Passkey]:
    return list((await session.execute(select(Passkey).where(Passkey.user_id == user_id).order_by(Passkey.created_at))).scalars())


# ---- registration ---------------------------------------------------------------
async def registration_options(session: AsyncSession, user: User, kind: str) -> tuple[str, dict]:
    existing = await user_passkeys(session, user.id)
    security_key = kind == "security_key"
    opts = generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.app_name,
        user_name=user.email,
        user_id=user.id.encode(),
        user_display_name=user.full_name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.CROSS_PLATFORM if security_key else AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[_descriptor(p) for p in existing],  # don't register the same authenticator twice
        hints=[PublicKeyCredentialHint.SECURITY_KEY] if security_key else [PublicKeyCredentialHint.CLIENT_DEVICE],
    )
    flow = await _new_challenge(session, ChallengePurpose.register, opts.challenge, user.id, {"kind": kind})
    return flow, json.loads(options_to_json(opts))


async def register(session: AsyncSession, user: User, flow_id: str, credential: dict, name: str) -> Passkey:
    ch = await consume_challenge(session, flow_id, ChallengePurpose.register, user.id)
    try:
        v = verify_registration_response(
            credential=credential,
            expected_challenge=ch.challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origins,
            require_user_verification=True,
        )
    except (InvalidRegistrationResponse, WebAuthnException, ValueError, KeyError) as exc:
        raise HTTPException(422, "This passkey couldn't be verified. Please try again.") from exc
    if (await session.execute(select(Passkey.id).where(Passkey.credential_id == v.credential_id))).first():
        raise HTTPException(409, "This passkey is already registered")
    transports = (credential.get("response") or {}).get("transports")
    pk = Passkey(
        user_id=user.id, credential_id=v.credential_id, public_key=v.credential_public_key, sign_count=v.sign_count,
        transports=transports if isinstance(transports, list) else None, aaguid=str(v.aaguid) if v.aaguid else None,
        name=name, kind=(ch.meta or {}).get("kind", "platform"), backed_up=v.credential_backed_up,
    )
    session.add(pk)
    user.passkey_count = len(await user_passkeys(session, user.id)) + 1
    await session.flush()
    return pk


# ---- authentication ---------------------------------------------------------------
async def authentication_options(session: AsyncSession, purpose: ChallengePurpose, user: User | None) -> tuple[str, dict]:
    """`user=None` → discoverable sign-in (the device offers its passkeys for this site).
    With a user → only that user's passkeys are acceptable (second factor, step-up)."""
    allow = [_descriptor(p) for p in await user_passkeys(session, user.id)] if user else []
    if user is not None and not allow:
        raise HTTPException(409, "No passkey is set up for this account")
    opts = generate_authentication_options(
        rp_id=settings.webauthn_rp_id, allow_credentials=allow, user_verification=UserVerificationRequirement.REQUIRED,
    )
    flow = await _new_challenge(session, purpose, opts.challenge, user.id if user else None)
    return flow, json.loads(options_to_json(opts))


async def authenticate(session: AsyncSession, flow_id: str, purpose: ChallengePurpose, credential: dict,
                       expected_user_id: str | None) -> tuple[Passkey, User]:
    ch = await consume_challenge(session, flow_id, purpose, expected_user_id)
    try:
        raw_id = base64url_to_bytes(credential.get("rawId") or credential["id"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(401, "Passkey sign-in failed") from exc
    pk = (await session.execute(select(Passkey).where(Passkey.credential_id == raw_id).with_for_update())).scalar_one_or_none()
    if pk is None:
        raise HTTPException(401, "This passkey isn't registered here. Sign in with your password, then add it.")
    if expected_user_id and pk.user_id != expected_user_id:
        raise HTTPException(401, "That passkey belongs to a different account")
    handle = (credential.get("response") or {}).get("userHandle")
    if handle and base64url_to_bytes(handle) != pk.user_id.encode():
        raise HTTPException(401, "Passkey sign-in failed")
    try:
        v = verify_authentication_response(
            credential=credential,
            expected_challenge=ch.challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origins,
            credential_public_key=pk.public_key,
            credential_current_sign_count=pk.sign_count,
            require_user_verification=True,
        )
    except (InvalidAuthenticationResponse, WebAuthnException, ValueError, KeyError) as exc:
        raise HTTPException(401, "Passkey sign-in failed") from exc
    user = await session.get(User, pk.user_id)
    if user is None or not user.is_active:
        raise HTTPException(403, "This account has been disabled")
    pk.sign_count, pk.backed_up, pk.last_used_at = v.new_sign_count, v.credential_backed_up, utcnow()
    return pk, user


def passkey_out(p: Passkey) -> dict:
    return {"id": p.id, "name": p.name, "kind": p.kind, "backed_up": p.backed_up, "created_at": p.created_at.isoformat(),
            "last_used_at": p.last_used_at.isoformat() if p.last_used_at else None,
            "credential_id": bytes_to_base64url(p.credential_id)[:12]}


async def purge_expired_challenges(session: AsyncSession) -> int:
    """Housekeeping (run by the worker): drop challenges more than a day past expiry."""
    res = await session.execute(delete(AuthChallenge).where(AuthChallenge.expires_at < utcnow() - timedelta(days=1)))
    await session.commit()
    return res.rowcount
