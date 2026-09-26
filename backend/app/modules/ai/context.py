"""What the assistant may see: aggregate campaign figures, already limited to the asking
person's area by the services that compute them. Never names, phones or ID numbers."""
import json
from datetime import timedelta

from sqlalchemy import select

from app.core.clock import TZ, utcnow
from app.core.deps import Ctx
from app.core.roles import ROLE_LABELS
from app.modules.calendar.service import CalendarService
from app.modules.dashboard.service import DashboardService
from app.modules.election.plan import plan_view
from app.modules.issues.service import IssueService
from app.modules.mapping.service import MapService


async def campaign_facts(ctx: Ctx) -> dict:
    now = utcnow()
    summary = await DashboardService(ctx).summary()
    wards = await MapService(ctx).ward_stats()
    plan = await plan_view(ctx)
    issues = await IssueService(ctx).stats(30)
    try:
        upcoming = await CalendarService(ctx).entries(now, now + timedelta(days=14))
    except Exception:  # the calendar is optional context
        upcoming = []
    return {
        "as_of": now.astimezone(TZ).strftime("%A %d %B %Y, %H:%M (Nairobi)"),
        "you": {"role": ROLE_LABELS[ctx.user.role]},
        "totals": summary.get("totals"),
        "election": {"date": plan["election_date"], "days_left": plan["days_left"]},
        "plan": {"target_total": plan["target_total"], "captured": plan["achieved"], "planned_by_today": plan["planned_by_today"],
                 "ahead_or_behind": plan["vs_plan"],
                 "weeks": [{k: w[k] for k in ("week_start", "target", "actual")} for w in plan["weeks"] if w["past"] or w["current"]][-6:]},
        "wards": [{"ward": w["name"], "constituency": w["constituency"], "target": w["target"], "registered_2022": w["registered_voters"],
                   "captured": w["achieved"], "verified": w["verified"], "supporters": w["supporters"], "percent_of_target": w["percent"],
                   "visits_done": w["visits_completed"], "visits_planned": w["visits_upcoming"], "last_visit": w["last_visit_at"]} for w in wards],
        "community_issues_30_days": {k: issues[k] for k in ("total", "open", "new", "resolved", "urgent", "median_hours_to_resolve")}
        | {"by_topic": [{"topic": c["label"], "total": c["total"], "open": c["open"]} for c in issues["by_category"]],
           "by_ward": [{"ward": w["ward"], "total": w["total"], "open": w["open"], "top_topic": w["top"]} for w in issues["by_ward"][:30]]},
        "next_14_days": [{"when": e.starts_at.astimezone(TZ).strftime("%a %d %b %H:%M"), "what": e.title, "kind": e.kind, "ward": e.ward}
                         for e in upcoming if e.source in ("visit", "event")][:40],
    }


def facts_json(facts: dict) -> str:
    return json.dumps(facts, default=str, separators=(",", ":"))
