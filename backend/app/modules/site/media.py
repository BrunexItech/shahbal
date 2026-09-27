"""Photos and videos for the public website.

Photos are decoded and re-encoded (WebP): that proves they really are images, drops EXIF
(phones stamp GPS positions into photos), fixes rotation and caps the size. Videos are
checked by their signature and streamed to disk in chunks, never held in memory."""
import asyncio
import io
import json
import logging
import secrets
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

IMAGE_MAX_MB = 15
VIDEO_MAX_MB = 95  # Cloudflare accepts at most 100 MB per request
MAX_SIDE, THUMB_SIDE = 2000, 720
Image.MAX_IMAGE_PIXELS = 60_000_000  # refuse decompression bombs

log = logging.getLogger("site.media")
VIDEO_TYPES = {"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}


def root() -> Path:
    d = Path(settings.recordings_dir).resolve().parent / "site-media"
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_of(name: str) -> Path:
    p = (root() / name).resolve()
    if p.parent != root():
        raise HTTPException(404, "Not found")
    return p


def _video_kind(head: bytes) -> str | None:
    if head[4:8] == b"ftyp":
        return "video/quicktime" if head[8:10] == b"qt" else "video/mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    return None


async def save_image(file: UploadFile) -> dict:
    data = await file.read(IMAGE_MAX_MB * 1024 * 1024 + 1)
    if len(data) > IMAGE_MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"Photos can be up to {IMAGE_MAX_MB} MB")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, "That file isn't a photo we can read. Use JPG, PNG or WebP.")
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
    base = secrets.token_hex(16)
    out: dict = {"kind": "image", "content_type": "image/webp"}
    for key, side, suffix in (("name", MAX_SIDE, ""), ("thumb", THUMB_SIDE, "-t")):
        copy = img.copy()
        copy.thumbnail((side, side))
        buf = io.BytesIO()
        copy.save(buf, "WEBP", quality=84, method=5)
        name = f"{base}{suffix}.webp"
        path_of(name).write_bytes(buf.getvalue())
        out[key] = name
        if key == "name":
            out["width"], out["height"], out["size"] = copy.width, copy.height, buf.tell()
    return out


async def save_video(file: UploadFile) -> dict:
    head = await file.read(16)
    ctype = _video_kind(head)
    if ctype is None:
        raise HTTPException(422, "Upload the video as MP4, WebM or MOV")
    name = f"{secrets.token_hex(16)}.{VIDEO_TYPES[ctype]}"
    path, size, limit = path_of(name), len(head), VIDEO_MAX_MB * 1024 * 1024
    try:
        with open(path, "wb") as f:
            f.write(head)
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Videos can be up to {VIDEO_MAX_MB} MB. For longer ones, post them on YouTube and add the link.")
                f.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {"kind": "video", "content_type": ctype, "name": name, "size": size, **await asyncio.to_thread(_video_extras, path)}


def _video_extras(path: Path) -> dict:
    """Length, size and a preview picture for an uploaded video, via ffprobe/ffmpeg when installed.
    Each step has a time limit, and a video that can't be read simply goes without a preview."""
    out: dict = {"thumb": None, "duration": None, "width": None, "height": None}
    if not (shutil.which("ffprobe") and shutil.which("ffmpeg")):
        return out
    try:
        probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
                                "-of", "json", str(path)], capture_output=True, timeout=20, check=True)
        info = json.loads(probe.stdout or b"{}")
        stream = (info.get("streams") or [{}])[0]
        duration = float((info.get("format") or {}).get("duration") or 0)
        out.update(width=stream.get("width"), height=stream.get("height"), duration=round(duration) or None)
        # A frame a little way in (not the black first frame), scaled down, re-encoded to WebP.
        at = min(max(duration * 0.1, 0.5), 5.0) if duration else 0
        frame = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.2f}", "-i", str(path), "-frames:v", "1",
                                "-vf", f"scale='min({THUMB_SIDE},iw)':-2", "-f", "image2pipe", "-vcodec", "png", "-"],
                               capture_output=True, timeout=30, check=True)
        if frame.stdout:
            img = Image.open(io.BytesIO(frame.stdout)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "WEBP", quality=80)
            thumb = f"{path.stem}-t.webp"
            path_of(thumb).write_bytes(buf.getvalue())
            out["thumb"] = thumb
    except (subprocess.SubprocessError, OSError, ValueError, UnidentifiedImageError) as exc:
        log.warning("couldn't read video %s: %s", path.name, exc)
    return out


def remove(name: str | None) -> None:
    if name:
        path_of(name).unlink(missing_ok=True)
