import enum
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class AgentStatus(str, enum.Enum):
    available = "available"
    ringing = "ringing"
    on_call = "on_call"
    wrap_up = "wrap_up"
    away = "away"


class AgentPresence(Base):
    """What each call-centre seat is doing right now (softphone heartbeats)."""

    __tablename__ = "agent_presence"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    status: Mapped[AgentStatus] = mapped_column(pg_enum(AgentStatus, "agent_status"), default=AgentStatus.available)
    voter_id: Mapped[str | None] = mapped_column(ForeignKey("voters.id", ondelete="SET NULL"))
    status_since: Mapped[datetime]
    heartbeat_at: Mapped[datetime] = mapped_column(index=True)
    line: Mapped[str | None] = mapped_column(String(20))  # sip | sandbox | phone
