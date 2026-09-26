"""Thin OpenAI client (Chat Completions over HTTPS). No SDK: one call, clear errors."""
import json
import logging

import httpx
from fastapi import HTTPException

from app.core.config import settings

log = logging.getLogger("ai")


def enabled() -> bool:
    return bool(settings.openai_api_key)


async def complete(system: str, user: str, *, as_json: bool = False, max_tokens: int = 1800) -> str:
    """One question, one answer. Raises a 503 the UI can show as-is when the service is unavailable."""
    if not enabled():
        raise HTTPException(503, "The AI assistant isn't switched on (no OpenAI key).")
    body: dict = {
        "model": settings.openai_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_completion_tokens": max_tokens,
    }
    if as_json:
        body["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(f"{settings.openai_base_url.rstrip('/')}/chat/completions", json=body,
                                  headers={"Authorization": f"Bearer {settings.openai_api_key}"})
    except httpx.HTTPError as exc:
        log.warning("OpenAI unreachable: %s", exc)
        raise HTTPException(503, "The AI service couldn't be reached. Try again in a moment.")
    if r.status_code == 401:
        raise HTTPException(503, "The OpenAI key was rejected. Check OPENAI_API_KEY.")
    if r.status_code == 429:
        raise HTTPException(503, "The AI service is busy or out of credit. Try again shortly.")
    if r.status_code >= 400:
        log.warning("OpenAI error %s: %s", r.status_code, r.text[:300])
        raise HTTPException(503, "The AI service returned an error. Try again in a moment.")
    try:
        text = r.json()["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError):
        raise HTTPException(503, "The AI service returned an unexpected answer.")
    return text.strip()


async def complete_json(system: str, user: str, **kw) -> dict:
    raw = await complete(system, user, as_json=True, **kw)
    try:
        return json.loads(raw)
    except ValueError:
        raise HTTPException(503, "The AI answer couldn't be read. Try again.")
