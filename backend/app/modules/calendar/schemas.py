from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

EventKind = Literal["media", "meeting", "debate", "fundraiser", "deadline", "travel", "other"]


class EventIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    kind: EventKind
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    constituency_id: str | None = None
    ward_id: str | None = None
    location: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)
    hq_only: bool = False
    repeat_weeks: int = Field(default=0, ge=0, le=26)  # also on the same weekday for N more weeks

    @model_validator(mode="after")
    def _order(self):
        if self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("The end must be after the start")
        return self


class EventPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    kind: EventKind | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    location: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)
    status: Literal["planned", "done", "cancelled"] | None = None


class Entry(BaseModel):
    """One thing on the calendar, whatever it comes from."""
    id: str
    source: Literal["event", "visit", "plan", "election", "sms"]
    kind: str
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    status: str | None = None
    ward_id: str | None = None
    ward: str | None = None
    constituency_id: str | None = None
    constituency: str | None = None
    location: str | None = None
    notes: str | None = None
    hq_only: bool = False
    series_id: str | None = None
    lead: str | None = None
    expected_attendance: int | None = None
    attendance: int | None = None
    target: int | None = None
    can_edit: bool = False


class Gap(BaseModel):
    ward_id: str
    ward: str
    constituency: str
    last_visit_at: datetime | None
    percent: float | None
