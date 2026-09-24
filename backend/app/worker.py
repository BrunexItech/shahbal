"""Background worker: message dispatch. Run as its own process/container:

    python -m app.worker
"""
import asyncio
import logging
import signal

from app import models  # noqa: F401
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.messaging.dispatcher import dispatch_once

log = logging.getLogger("worker")


async def main() -> None:
    settings.assert_production_safe()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker started (sms=%s, whatsapp=%s)", settings.sms_provider, settings.whatsapp_provider)
    while not stop.is_set():
        try:
            sent = await dispatch_once(SessionLocal)
        except Exception:  # never let one bad batch kill the worker
            log.exception("dispatch failed")
            sent = 0
        if not sent:  # drain fast while there is work, idle politely otherwise
            try:
                await asyncio.wait_for(stop.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(main())
