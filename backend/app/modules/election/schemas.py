from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.messaging.models import Channel


class SettingsIn(BaseModel):
    election_date: date | None = None
    polls_open: str = Field(default="06:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    polls_close: str = Field(default="17:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    candidate_label: str = Field(default="our candidate", min_length=2, max_length=80)


class SettingsOut(SettingsIn):
    model_config = ConfigDict(from_attributes=True)
    days_to_go: int | None = None
    is_election_day: bool = False


class MarkIn(BaseModel):
    voted: bool = True


class TurnoutRow(BaseModel):
    id: str
    name: str
    parent: str | None = None
    targets: int  # supporters + leaners (the GOTV universe)
    voted: int
    percent: float | None


class TurnoutOut(BaseModel):
    overall: TurnoutRow
    wards: list[TurnoutRow]
    stations: list[TurnoutRow]
    last_hour: int


class ReminderPlanIn(BaseModel):
    channel: Channel = Channel.sms


class RosterRow(BaseModel):
    id: str
    reference: str
    full_name: str
    phone: str
    support: str
    voted_at: datetime | None
