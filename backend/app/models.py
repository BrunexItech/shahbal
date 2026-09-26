"""Imports every model so Alembic autogenerate and metadata.create_all see them."""
from app.modules.audit.models import AuditLog  # noqa: F401
from app.modules.auth.models import AuthChallenge, KnownDevice, Passkey  # noqa: F401
from app.modules.calls.models import CallLog  # noqa: F401
from app.modules.election.models import Candidate, ElectionSettings, PlanWeek, ResultForm  # noqa: F401
from app.modules.live.models import AgentPresence  # noqa: F401
from app.modules.geo.models import Constituency, PollingStation, Ward  # noqa: F401
from app.modules.messaging.models import Message, MessageCampaign  # noqa: F401
from app.modules.users.models import User, UserInvite, UserSession  # noqa: F401
from app.modules.visits.models import Visit, VisitPhoto  # noqa: F401
from app.modules.voters.models import Voter  # noqa: F401
from app.modules.issues.models import Issue, IssuePhoto, IssueUpdate  # noqa: F401
from app.modules.calendar.models import CalendarEvent  # noqa: F401
from app.modules.assignments.models import Assignment  # noqa: F401
from app.modules.privacy.models import DataRequest  # noqa: F401
from app.modules.site.models import NewsPost, SitePage, Volunteer  # noqa: F401
