from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.messaging.models import CampaignStatus, Channel
from app.modules.visits.models import VisitStatus


class VisitIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    ward_id: str
    station_id: str | None = None
    venue: str = Field(min_length=2, max_length=160)
    scheduled_at: datetime
    lead_id: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    announce: bool = True
    announce_hours_before: int = Field(default=24, ge=1, le=168)
    channel: Channel = Channel.sms
    message: str | None = Field(default=None, max_length=600)


class VisitUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    venue: str | None = Field(default=None, min_length=2, max_length=160)
    scheduled_at: datetime | None = None
    lead_id: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


class CheckinIn(BaseModel):
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class CompleteIn(BaseModel):
    attendance: int | None = Field(default=None, ge=0, le=1_000_000)
    outcome: str | None = Field(default=None, max_length=4000)


class VisitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    ward_id: str
    ward_name: str | None = None
    constituency_name: str | None = None
    station_id: str | None
    station_name: str | None = None
    venue: str
    scheduled_at: datetime
    status: VisitStatus
    lead_id: str | None
    lead_name: str | None = None
    notes: str | None
    announce: bool
    announce_hours_before: int
    announcement_campaign_id: str | None
    announcement_status: CampaignStatus | None = None
    announcement_recipients: int | None = None
    checkin_at: datetime | None
    checkin_lat: float | None
    checkin_lng: float | None
    completed_at: datetime | None
    attendance: int | None
    outcome: str | None
    created_at: datetime
