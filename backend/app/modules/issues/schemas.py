from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.phone import to_e164
from app.modules.issues.models import Category, IssueSource, IssueStatus, Priority


def _clean(v: str | None) -> str | None:
    return " ".join(v.split()) if v and v.strip() else None


class IssueBase(BaseModel):
    category: Category
    summary: str | None = Field(default=None, max_length=140)
    description: str = Field(min_length=10, max_length=2000)
    ward_id: str
    area: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    reporter_name: str | None = Field(default=None, max_length=120)
    reporter_phone: str | None = None
    contact_ok: bool = False
    consent: bool

    @field_validator("summary", "area", "reporter_name")
    @classmethod
    def _tidy(cls, v: str | None) -> str | None:
        return _clean(v)

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        return v.strip()

    @field_validator("reporter_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return to_e164(v) if v and v.strip() else None

    @model_validator(mode="after")
    def _rules(self):
        if not self.consent:
            raise ValueError("Consent is required to record this report")
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude go together")
        if self.contact_ok and not self.reporter_phone:
            raise ValueError("Add a phone number to receive updates")
        if not self.summary:
            first = self.description.split("\n")[0]
            self.summary = first if len(first) <= 140 else first[:137].rstrip() + "…"
        return self


class PublicIssueIn(IssueBase):
    website: str | None = None  # honeypot


class StaffIssueIn(IssueBase):
    voter_id: str | None = None
    priority: Priority = Priority.normal
    client_ref: str | None = Field(default=None, max_length=64)


class IssuePatch(BaseModel):
    status: IssueStatus | None = None
    priority: Priority | None = None
    category: Category | None = None
    assigned_to_id: str | None = None
    unassign: bool = False
    note: str | None = Field(default=None, max_length=1000)  # why: shown with the change
    public: bool = False  # share `note` with the reporter (and SMS them if they agreed)


class NoteIn(BaseModel):
    note: str = Field(min_length=2, max_length=1000)
    public: bool = False


class IssueUpdateOut(BaseModel):
    id: str
    kind: str
    status: IssueStatus | None
    note: str | None
    public: bool
    author: str | None
    created_at: datetime


class IssuePhotoOut(BaseModel):
    id: str
    url: str
    width: int
    height: int
    by_resident: bool
    created_at: datetime


class IssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    reference: str
    category: Category
    summary: str
    description: str
    ward_id: str
    ward: str
    constituency: str
    area: str | None
    latitude: float | None
    longitude: float | None
    source: IssueSource
    status: IssueStatus
    priority: Priority
    assigned_to_id: str | None
    assigned_to: str | None
    reporter_name: str | None
    reporter_phone: str | None  # managers only; masked for everyone else
    contact_ok: bool
    reported_by: str | None
    photos: int
    created_at: datetime
    updated_at: datetime | None
    resolved_at: datetime | None


class IssueDetail(IssueOut):
    updates: list[IssueUpdateOut]
    photo_list: list[IssuePhotoOut]
    can_manage: bool


class IssuePage(BaseModel):
    items: list[IssueOut]
    total: int


class PublicReceipt(BaseModel):
    reference: str
    upload_token: str  # lets the same browser attach photos for the next 30 minutes
    message: str


class PublicUpdate(BaseModel):
    status: IssueStatus | None
    note: str | None
    created_at: datetime


class PublicTrack(BaseModel):
    reference: str
    category: Category
    summary: str
    ward: str
    status: IssueStatus
    created_at: datetime
    resolved_at: datetime | None
    updates: list[PublicUpdate]


class Assignee(BaseModel):
    id: str
    full_name: str
    role: str
