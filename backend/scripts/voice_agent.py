"""Create or update the "Talk to Shahbal" phone assistant on ElevenLabs.

    python -m scripts.voice_agent          # create (first run) or update it, and refresh its knowledge

The same as "Refresh what it knows" in the Command Centre. The first run prints ELEVENLABS_AGENT_ID
for backend/.env. The assistant itself is defined in app/modules/voiceline/agent.py.
"""
import asyncio
import sys

import app.models  # noqa: F401  (register every table)
from app.core.config import settings
from app.modules.voiceline.agent import NAME, AgentError, sync


async def main() -> None:
    try:
        done = await sync()
    except AgentError as e:
        sys.exit(str(e))
    print(f"Agent ready: {NAME}")
    print(f"Knowledge: {done['knowledge_chars']:,} characters from the published website")
    if done["created"] and not settings.elevenlabs_agent_id.strip():
        print(f"\nAdd this line to backend/.env:\nELEVENLABS_AGENT_ID={done['agent_id']}")


if __name__ == "__main__":
    asyncio.run(main())
