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
    portal_rate_limit_per_hour: int = 10
    testing: bool = False

    # "production" turns on: secure cookies, HSTS, mandatory 2FA for MFA_ROLES,
    # and a hard refusal to boot with any default secret.
    environment: str = "development"
    session_hours: int = 12
    cookie_name: str = "chq_session"
    mfa_roles: list[str] = ["super_admin"]
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
    messaging_quiet_start: int = 21  # no sends 21:00–07:59 EAT (courtesy + compliance)
    messaging_quiet_end: int = 8

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def assert_production_safe(self) -> None:
        if not self.is_production:
            return
        weak = [k for k in ("jwt_secret", "pii_pepper", "webhook_secret") if getattr(self, k).startswith("change-me")]
        if self.pii_key == _DEV_PII_KEY:
            weak.append("pii_key")
        if weak:
            raise RuntimeError(f"Refusing to start in production with default secrets: {', '.join(weak)}")


settings = Settings()
