"""Imports every model so Alembic autogenerate and metadata.create_all see them."""
from app.modules.audit.models import AuditLog  # noqa: F401
from app.modules.calls.models import CallLog  # noqa: F401
from app.modules.election.models import ElectionSettings  # noqa: F401
from app.modules.geo.models import Constituency, PollingStation, Ward  # noqa: F401
from app.modules.messaging.models import Message, MessageCampaign  # noqa: F401
from app.modules.users.models import User, UserSession  # noqa: F401
from app.modules.visits.models import Visit  # noqa: F401
from app.modules.voters.models import Voter  # noqa: F401
