from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.calls.models import Outcome, Queue
from app.modules.voters.models import Support
from app.modules.voters.schemas import VoterOut


class NextIn(BaseModel):
    queue: Queue
    ward_id: str | None = None
    constituency_id: str | None = None


class CallIn(BaseModel):
    voter_id: str
    queue: Queue
    outcome: Outcome
    support: Support | None = None
    verify: bool = False  # answered + confirmed details → mark verified
    notes: str | None = Field(default=None, max_length=2000)
    issue: str | None = Field(default=None, max_length=120)
    duration_seconds: int | None = Field(default=None, ge=0, le=6 * 3600)
    follow_up_at: datetime | None = None


class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    voter_id: str
    agent_name: str | None = None
    queue: Queue
    outcome: Outcome
    support_after: str | None
    notes: str | None
    issue: str | None
    duration_seconds: int | None
    follow_up_at: datetime | None
    created_at: datetime


class Claim(BaseModel):
    voter: VoterOut
    history: list[CallOut]
    locked_until: datetime
    remaining: int


class QueueCounts(BaseModel):
    verify: int
    persuade: int
    gotv: int
    follow_up: int


class AgentStat(BaseModel):
    agent_id: str
    agent_name: str
    calls: int
    answered: int
    verified: int
