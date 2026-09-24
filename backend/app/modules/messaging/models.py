import enum
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pg_enum


class Channel(str, enum.Enum):
    sms = "sms"
    whatsapp = "whatsapp"


class Kind(str, enum.Enum):
    broadcast = "broadcast"
    visit = "visit"
    gotv = "gotv"


class CampaignStatus(str, enum.Enum):
    pending_approval = "pending_approval"
    scheduled = "scheduled"
    sending = "sending"
    sent = "sent"
    cancelled = "cancelled"
    rejected = "rejected"


class MessageStatus(str, enum.Enum):
    queued = "queued"
    sent = "sent"
    delivered = "delivered"
    failed = "failed"


class MessageCampaign(Base):
    __tablename__ = "message_campaigns"

    name: Mapped[str] = mapped_column(String(120))
    channel: Mapped[Channel] = mapped_column(pg_enum(Channel, "channel"))
    kind: Mapped[Kind] = mapped_column(pg_enum(Kind, "campaign_kind"), default=Kind.broadcast)
    body: Mapped[str] = mapped_column(Text)
    audience: Mapped[dict] = mapped_column(JSON)
    status: Mapped[CampaignStatus] = mapped_column(pg_enum(CampaignStatus, "campaign_status"), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(index=True)
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    created_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reviewed_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    review_note: Mapped[str | None] = mapped_column(String(240))
    visit_id: Mapped[str | None] = mapped_column(String(36), index=True)

    recipients: Mapped[int] = mapped_column(default=0)
    sent: Mapped[int] = mapped_column(default=0)
    delivered: Mapped[int] = mapped_column(default=0)
    failed: Mapped[int] = mapped_column(default=0)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("campaign_id", "voter_id", name="uq_message_campaign_voter"),)

    campaign_id: Mapped[str] = mapped_column(ForeignKey("message_campaigns.id", ondelete="CASCADE"), index=True)
    voter_id: Mapped[str] = mapped_column(ForeignKey("voters.id", ondelete="CASCADE"), index=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[MessageStatus] = mapped_column(pg_enum(MessageStatus, "message_status"), default=MessageStatus.queued, index=True)
    provider_id: Mapped[str | None] = mapped_column(String(120), index=True)
    error: Mapped[str | None] = mapped_column(String(240))
    cost: Mapped[str | None] = mapped_column(String(40))
    sent_at: Mapped[datetime | None]
    delivered_at: Mapped[datetime | None]
