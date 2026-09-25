from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_PII_KEY = "2MesYK4i6ND3GqNotS8WzILNrn6C4A3si1WUjYLcVKA="


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Campaign HQ"
    timezone: str = "Africa/Nairobi"
    database_url: str = "postgresql+asyncpg://shahbal:shahbal@localhost:5436/shahbal"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"

    # Field-level encryption for national ID numbers. `pii_key` is a Fernet key
    # (encryption at rest); `pii_pepper` keys the HMAC used as the dedup index, so
    # the lookup column never stores a reversible or rainbow-tableable hash.
    pii_key: str = _DEV_PII_KEY  # dev only — set PII_KEY in prod
    pii_pepper: str = "change-me-pepper"

    cors_origins: list[str] = ["http://localhost:3000"]
    # Public address of the web app: invitation links point here.
    app_url: str = "http://localhost:3000"
    # Absolute API base for links that leave the app (e.g. photo URLs inside GIS Lab
    # projects). Empty = same origin as the app: {app_url}/api/v1.
    api_public_url: str = ""
    # Where the GIS Lab (GeoLibre) runs. Its origin may fetch one-time project links.
    gis_origin: str = "http://localhost:8081"
    invite_hours: int = 72
    # Outgoing email for invitations (unset = links are shown to the inviter instead).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    # How to find the real client IP (rate limits + audit). X-Forwarded-For's
    # leftmost value is client-controlled, so we only trust hops appended by our
    # own proxies: set TRUSTED_PROXIES to how many sit in front of the API
    # (gateway = 1, host nginx + gateway = 2). Or name a header your edge sets
    # and clients can't forge, e.g. CLIENT_IP_HEADER=cf-connecting-ip behind Cloudflare.
    trusted_proxies: int = 0
    client_ip_header: str | None = None
    portal_rate_limit_per_hour: int = 10
    testing: bool = False

    # "production" turns on: secure cookies, HSTS, mandatory 2FA for MFA_ROLES,
    # and a hard refusal to boot with any default secret.
    environment: str = "development"
    session_hours: int = 12
    # Signed out after this long with no taps, clicks or key presses (live updates don't
    # count). Field phones get a shorter window: they're the ones left lying around.
    idle_minutes_field: int = 15
    idle_minutes_command: int = 30
    cookie_name: str = "chq_session"
    # Production: every staff role must enrol a passkey or an authenticator app.
    mfa_roles: list[str] = ["super_admin", "coordinator", "ward_coordinator", "field_agent", "call_agent", "viewer"]
    # Re-confirmation window for sensitive actions (reveal ID, exports, approvals, team changes).
    step_up_minutes: int = 5
    device_cookie_name: str = "chq_device"

    # Passkeys (WebAuthn). rp_id is the bare domain the app is served on; origins
    # are the exact page origins allowed to run the ceremony.
    webauthn_rp_id: str = "localhost"
    webauthn_origins: list[str] = ["http://localhost:3000", "http://localhost:8090"]
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    # Messaging
    sms_provider: str = "sandbox"  # sandbox | africastalking
    at_username: str = "sandbox"
    at_api_key: str = ""
    at_sender_id: str | None = None
    whatsapp_provider: str = "sandbox"  # sandbox | cloud
    wa_phone_number_id: str = ""
    wa_access_token: str = ""
    wa_template: str = "campaign_update"
    wa_template_lang: str = "en"
    webhook_secret: str = "change-me-webhook"

    # Call centre telephony. "sandbox" simulates calls (development/training);
    # "sip" registers each agent's browser softphone with a SIP-over-WebSocket
    # provider (Africa's Talking SIP, Yeastar, Asterisk, …).
    voice_provider: str = "sandbox"  # sandbox | sip
    sip_wss_url: str = ""  # e.g. wss://sip.provider.co.ke:7443
    sip_domain: str = ""  # e.g. sip.provider.co.ke
    sip_caller_id: str = ""  # number shown to voters
    stun_servers: list[str] = ["stun:stun.l.google.com:19302"]
    recordings_dir: str = "./data/recordings"  # a persistent volume in production (photos live in a sibling folder)
    recording_retention_days: int = 90
    recording_max_mb: int = 50
    messaging_quiet_start: int = 21  # no sends 21:00–07:59 EAT (courtesy + compliance)
    messaging_quiet_end: int = 8

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def api_base(self) -> str:
        return (self.api_public_url or f"{self.app_url.rstrip('/')}/api/v1").rstrip("/")

    def assert_production_safe(self) -> None:
        if not self.is_production:
            return
        weak = [k for k in ("jwt_secret", "pii_pepper", "webhook_secret") if getattr(self, k).startswith("change-me")]
        if self.pii_key == _DEV_PII_KEY:
            weak.append("pii_key")
        if weak:
            raise RuntimeError(f"Refusing to start in production with default secrets: {', '.join(weak)}")


settings = Settings()
