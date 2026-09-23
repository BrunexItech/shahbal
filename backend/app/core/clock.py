from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import Date, cast, func

from app.core.config import settings

TZ = ZoneInfo(settings.timezone)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def local_midnight(days_ago: int = 0) -> datetime:
    """Start of the local (campaign) day, as an aware datetime usable against timestamptz."""
    now = datetime.now(TZ)
    return now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)


def local_date(column):
    """SQL expression: the campaign-local calendar date of a timestamptz column."""
    return cast(func.timezone(settings.timezone, column), Date)
