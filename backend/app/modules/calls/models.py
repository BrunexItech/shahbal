import enum
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class Outcome(str, enum.Enum):
    answered = "answered"
    no_answer = "no_answer"
    busy = "busy"
    call_back = "call_back"
    wrong_number = "wrong_number"
    do_not_call = "do_not_call"


class Queue(str, enum.Enum):
    verify = "verify"  # pending records: confirm details
    persuade = "persuade"  # verified undecided / leaning / unknown
    gotv = "gotv"  # supporters & leaners who haven't voted
    follow_up = "follow_up"  # promised call-backs that are due


class CallLog(Base):
    __tablename__ = "call_logs"

    voter_id: Mapped[str] = mapped_column(ForeignKey("voters.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    queue: Mapped[Queue] = mapped_column(pg_enum(Queue, "call_queue"))
    outcome: Mapped[Outcome] = mapped_column(pg_enum(Outcome, "call_outcome"), index=True)
    # Plain string (validated as Support at the API edge) to avoid sharing a PG enum type across tables.
    support_after: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)
    duration_seconds: Mapped[int | None]
    follow_up_at: Mapped[datetime | None] = mapped_column(index=True)
    follow_up_done: Mapped[bool] = mapped_column(default=False)
    issue: Mapped[str | None] = mapped_column(String(120))


class SipAccount(Base):
    """Per-agent SIP credentials for the browser softphone (password encrypted)."""

    __tablename__ = "sip_accounts"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    sip_user: Mapped[str] = mapped_column(String(80))
    sip_password_enc: Mapped[str] = mapped_column(Text)


class CallRecording(Base):
    """An encrypted call recording (AES-256-GCM at rest). Voice is personal data:
    supervisors-only playback behind re-confirmation, audited, auto-deleted."""

    __tablename__ = "call_recordings"

    agent_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    voter_id: Mapped[str | None] = mapped_column(ForeignKey("voters.id", ondelete="SET NULL"), index=True)
    call_log_id: Mapped[str | None] = mapped_column(ForeignKey("call_logs.id", ondelete="SET NULL"), index=True)
    dialled_last4: Mapped[str | None] = mapped_column(String(4))
    duration_seconds: Mapped[int] = mapped_column(default=0)
    mime: Mapped[str] = mapped_column(String(60))
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    path: Mapped[str] = mapped_column(String(300))
    line: Mapped[str] = mapped_column(String(20))  # sip | sandbox
