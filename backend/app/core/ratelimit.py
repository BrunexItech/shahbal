"""Tiny fixed-window limiter for public endpoints. In-process by design for a
single API container; swap the backend for Redis when scaling horizontally —
callers only depend on `RateLimiter.hit`."""
import time
from collections import defaultdict

from fastapi import HTTPException, Request

from app.core.config import settings


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def hit(self, key: str) -> None:
        now = time.monotonic()
        hits = [t for t in self._hits[key] if now - t < self.window]
        if len(hits) >= self.limit:
            raise HTTPException(429, "Too many submissions. Please try again later.")
        hits.append(now)
        self._hits[key] = hits


def client_ip(request: Request) -> str:
    if settings.client_ip_header:
        value = request.headers.get(settings.client_ip_header, "").strip()
        if value:
            return value[:64]
    peer = request.client.host if request.client else "unknown"
    if settings.trusted_proxies > 0:
        hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        # Each trusted proxy appends the address it received from; the entry
        # our outermost proxy wrote is the first one a client cannot forge.
        if len(hops) >= settings.trusted_proxies:
            return hops[-settings.trusted_proxies][:64]
    return peer
