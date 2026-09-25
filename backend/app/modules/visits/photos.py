"""Visit photos: proof of presence for HQ, shown on the Command Centre map and in GIS Lab.

Photos are re-encoded (max 1600 px, JPEG) which drops every bit of phone metadata,
then stored AES-GCM encrypted in the vault. Anyone who can see the visit can see its
photos; only the person who took one, or a manager, can delete it.
"""
import io

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select

from app.core import audit, vault
from app.core.deps import Ctx
from app.core.roles import MANAGERS, Role
from app.modules.users.models import User
from app.modules.visits.models import Visit, VisitPhoto, VisitStatus
from app.modules.visits.service import VisitService

NS = "visit-photos"
MAX_BYTES = 12 * 1024 * 1024
MAX_SIDE = 1600
MAX_PER_VISIT = 12


def clean(raw: bytes) -> tuple[bytes, int, int]:
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Photo is too large (12 MB max)")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in ("JPEG", "PNG", "WEBP", "HEIF", "MPO"):
            raise HTTPException(415, "Use a JPEG, PNG or WebP photo")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "That file isn't a readable photo")
    img = ImageOps.exif_transpose(img).convert("RGB")
    if min(img.size) < 200:
        raise HTTPException(422, "Photo is too small")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True, progressive=True)
    return out.getvalue(), img.width, img.height


def photo_url(visit_id: str, photo_id: str) -> str:
    return f"/api/v1/visits/{visit_id}/photos/{photo_id}"


class VisitPhotoService:
    def __init__(self, ctx: Ctx):
        self.ctx, self.s, self.user = ctx, ctx.session, ctx.user

    async def _visible_visit(self, vid: str) -> Visit:
        await VisitService(self.ctx).get(vid)  # 404 if outside this user's area
        return await self.s.get(Visit, vid)

    async def list(self, vid: str) -> list[dict]:
        await self._visible_visit(vid)
        rows = (await self.s.execute(
            select(VisitPhoto, User.full_name).join(User, User.id == VisitPhoto.taken_by_id)
            .where(VisitPhoto.visit_id == vid).order_by(VisitPhoto.created_at)
        )).all()
        return [{"id": p.id, "url": photo_url(vid, p.id), "width": p.width, "height": p.height,
                 "taken_by": name, "taken_by_id": p.taken_by_id, "created_at": p.created_at} for p, name in rows]

    async def add(self, vid: str, raw: bytes) -> dict:
        if self.user.role not in MANAGERS | {Role.field_agent}:
            raise HTTPException(403, "You cannot add visit photos")
        v = await self._visible_visit(vid)
        if v.status not in (VisitStatus.in_progress, VisitStatus.completed):
            raise HTTPException(409, "Check in to the visit before adding photos")
        count = (await self.s.execute(select(func.count()).where(VisitPhoto.visit_id == vid))).scalar_one()
        if count >= MAX_PER_VISIT:
            raise HTTPException(409, f"A visit can have at most {MAX_PER_VISIT} photos")
        jpeg, w, h = clean(raw)
        path, sha = vault.store(jpeg, ns=NS)
        p = VisitPhoto(visit_id=vid, path=path, sha256=sha, width=w, height=h, taken_by_id=self.user.id)
        self.s.add(p)
        await self.s.flush()
        audit.record(self.s, actor_id=self.user.id, action="PHOTO_ADD", entity="visit", entity_id=vid, ip=self.ctx.ip, photo_id=p.id)
        await self.s.commit()
        return next(x for x in await self.list(vid) if x["id"] == p.id)

    async def read(self, vid: str, pid: str) -> bytes:
        await self._visible_visit(vid)
        p = await self.s.get(VisitPhoto, pid)
        if p is None or p.visit_id != vid:
            raise HTTPException(404, "Photo not found")
        try:
            return vault.load(p.path, p.sha256, ns=NS)
        except FileNotFoundError:
            raise HTTPException(404, "Photo not found")

    async def delete(self, vid: str, pid: str) -> None:
        await self._visible_visit(vid)
        p = await self.s.get(VisitPhoto, pid)
        if p is None or p.visit_id != vid:
            raise HTTPException(404, "Photo not found")
        if p.taken_by_id != self.user.id and self.user.role not in MANAGERS:
            raise HTTPException(403, "Only the person who took it, or a coordinator, can delete this photo")
        await self.s.delete(p)
        audit.record(self.s, actor_id=self.user.id, action="PHOTO_DELETE", entity="visit", entity_id=vid, ip=self.ctx.ip, photo_id=pid)
        await self.s.commit()
        vault.delete(p.path, ns=NS)
