from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.messaging.models import CampaignStatus, Channel, Kind, MessageStatus
from app.modules.voters.audience import Audience


class PreviewIn(BaseModel):
    channel: Channel = Channel.sms
    body: str = Field(min_length=1, max_length=1000)
    audience: Audience = Field(default_factory=Audience)


class PreviewOut(BaseModel):
    recipients: int
    sample: str | None
    chars: int
    segments: int
    unknown_placeholders: list[str]


class CampaignIn(PreviewIn):
    name: str = Field(min_length=3, max_length=120)
    scheduled_at: datetime | None = None  # None = send as soon as approved

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        return v


class ReviewIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=240)


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    channel: Channel
    kind: Kind
    body: str
    audience: dict
    status: CampaignStatus
    scheduled_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    created_by_name: str | None = None
    reviewed_by_name: str | None = None
    review_note: str | None
    visit_id: str | None
    recipients: int
    sent: int
    delivered: int
    failed: int
    created_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    phone: str
    voter_id: str
    voter_name: str | None = None
    status: MessageStatus
    error: str | None
    sent_at: datetime | None
    delivered_at: datetime | None
