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
    is_active: bool


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
