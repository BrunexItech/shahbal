from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.messaging.models import CampaignStatus, Channel
from app.modules.visits.models import VisitStatus

VisitKind = Literal["visit", "rally", "town_hall", "market_walk", "door_to_door", "community_meeting"]


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
    kind: VisitKind = "visit"
    ends_at: datetime | None = None
    expected_attendance: int | None = Field(default=None, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def _order(self):
        if self.ends_at and self.ends_at <= self.scheduled_at:
            raise ValueError("The end must be after the start")
        return self


class VisitUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    venue: str | None = Field(default=None, min_length=2, max_length=160)
    scheduled_at: datetime | None = None
    lead_id: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    kind: VisitKind | None = None
    ends_at: datetime | None = None
    expected_attendance: int | None = Field(default=None, ge=0, le=1_000_000)


class QuickVisitIn(BaseModel):
    """"I'm here now": log an unplanned visit in one tap, located by GPS."""
    venue: str = Field(min_length=2, max_length=160)
    title: str | None = Field(default=None, max_length=140)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    ward_id: str | None = None  # only used when GPS falls outside every ward (e.g. on the water)


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
    kind: str = "visit"
    ends_at: datetime | None = None
    expected_attendance: int | None = None
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
