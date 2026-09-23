from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Campaign HQ"
    timezone: str = "Africa/Nairobi"
    database_url: str = "postgresql+asyncpg://shahbal:shahbal@localhost:5436/shahbal"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 12 * 60

    # Field-level encryption for national ID numbers. `pii_key` is a Fernet key
    # (encryption at rest); `pii_pepper` keys the HMAC used as the dedup index, so
    # the lookup column never stores a reversible or rainbow-tableable hash.
    pii_key: str = "2MesYK4i6ND3GqNotS8WzILNrn6C4A3si1WUjYLcVKA="  # dev only — set PII_KEY in prod
    pii_pepper: str = "change-me-pepper"

    cors_origins: list[str] = ["http://localhost:3000"]
    portal_rate_limit_per_hour: int = 10
    testing: bool = False


settings = Settings()
