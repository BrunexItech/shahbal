from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class WardOut(_Out):
    id: str
    code: str
    name: str
    constituency_id: str
    registered_voters: int | None
    target: int


class ConstituencyOut(_Out):
    id: str
    code: str
    name: str
    county: str
    wards: list[WardOut] = []


class WardUpdate(BaseModel):
    target: int | None = Field(default=None, ge=0)
    registered_voters: int | None = Field(default=None, ge=0)


class StationOut(_Out):
    id: str
    code: str
    name: str
    ward_id: str
    streams: int
    registered_voters: int | None
    target: int
    latitude: float | None
    longitude: float | None
    location_quality: str | None = None
    is_active: bool
    pin_pending: bool = False


class StationIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=2, max_length=160)
    ward_id: str
    streams: int = Field(default=1, ge=1)
    registered_voters: int | None = Field(default=None, ge=0)
    target: int = Field(default=0, ge=0)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_active: bool = True


class StationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    streams: int | None = Field(default=None, ge=1)
    registered_voters: int | None = Field(default=None, ge=0)
    target: int | None = Field(default=None, ge=0)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_active: bool | None = None


class ImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]
    seen: set[str] = Field(default_factory=set, exclude=True)  # codes in the file (internal)


class PinIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0, le=10_000)  # metres, as the phone reports it


class PinOut(BaseModel):
    station_id: str
    station: str
    code: str
    ward_id: str
    ward: str
    latitude: float | None  # current pin (None = never mapped)
    longitude: float | None
    location_quality: str | None
    pin_lat: float
    pin_lng: float
    pin_accuracy: float | None
    pin_by: str | None
    pin_at: datetime | None
    moved_m: int | None  # how far the proposal is from the current pin
