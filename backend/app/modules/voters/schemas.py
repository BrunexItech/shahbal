from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.clock import TZ
from app.core.phone import to_e164
from app.modules.voters.models import Gender, Source, Status, Support

ADULT_AGE = 18


def check_adult(year: int | None) -> int | None:
    """Only adults (18+) can vote. Judged on the current year, so someone born in
    2008 qualifies from 1 January 2026; checked at request time, never at start-up."""
    if year is not None and year > datetime.now(TZ).year - ADULT_AGE:
        raise ValueError(f"Must be {ADULT_AGE} or older")
    return year

class VoterBase(BaseModel):
    full_name: str = Field(min_length=3, max_length=160)
    phone: str
    voter_card_no: str | None = Field(default=None, max_length=40)
    gender: Gender | None = None
    birth_year: int | None = Field(default=None, ge=1900)
    ward_id: str
    station_id: str | None = None

    @field_validator("birth_year")
    @classmethod
    def _adult(cls, v: int | None) -> int | None:
        return check_adult(v)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not all(ch.isalpha() or ch in " -'." for ch in v):
            raise ValueError("Name may only contain letters, spaces, hyphens and apostrophes")
        return v.title()

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return to_e164(v)


class NationalIdMixin(BaseModel):
    national_id: str = Field(min_length=6, max_length=12)

    @field_validator("national_id")
    @classmethod
    def _nid(cls, v: str) -> str:
        v = v.strip().replace(" ", "")
        if not v.isdigit():
            raise ValueError("National ID must contain digits only")
        return v


class ConsentMixin(BaseModel):
    consent: bool

    @field_validator("consent")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if not v:
            raise ValueError("Consent is required before saving these details")
        return v


class VoterCreate(VoterBase, NationalIdMixin, ConsentMixin):
    # Everyone new must give a year of birth, so we know they're 18+ (VoterBase checks it).
    birth_year: int = Field(ge=1900)
    client_ref: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    support: Support = Support.unknown
    notes: str | None = Field(default=None, max_length=2000)
    capture_lat: float | None = Field(default=None, ge=-90, le=90)
    capture_lng: float | None = Field(default=None, ge=-180, le=180)


class VoterUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=3, max_length=160)
    phone: str | None = None
    voter_card_no: str | None = Field(default=None, max_length=40)
    gender: Gender | None = None
    birth_year: int | None = Field(default=None, ge=1900)
    ward_id: str | None = None
    station_id: str | None = None
    support: Support | None = None
    notes: str | None = Field(default=None, max_length=2000)
    opted_out: bool | None = None
    do_not_call: bool | None = None

    @field_validator("birth_year")
    @classmethod
    def _adult(cls, v: int | None) -> int | None:
        return check_adult(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return to_e164(v) if v else v


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=240)


class VoterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    reference: str
    full_name: str
    phone: str
    national_id_masked: str
    voter_card_no: str | None
    gender: Gender | None
    birth_year: int | None
    ward_id: str
    ward_name: str | None = None
    constituency_name: str | None = None
    station_id: str | None
    station_name: str | None = None
    support: Support
    source: Source
    status: Status
    rejection_reason: str | None
    opted_out: bool
    do_not_call: bool = False
    last_contacted_at: datetime | None = None
    voted_at: datetime | None = None
    notes: str | None
    captured_by_name: str | None = None
    verified_by_name: str | None = None
    verified_at: datetime | None
    consent_at: datetime
    created_at: datetime


class DuplicateCheck(BaseModel):
    exists: bool
    reference: str | None = None
    full_name: str | None = None
    ward_name: str | None = None
