"""Unified attachment API routes."""

from __future__ import annotations

import mimetypes
import logging
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from fastapi.responses import JSONResponse, StreamingResponse

from clock import Clock
from config import AppSettings
from serialization import attachment_to_dict, schedule_attachment_to_dict
from server.attachment_helpers import make_attachment_service
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    AttachmentGetRequest,
    AttachmentInitUploadRequest,
    AttachmentListRequest,
    AttachmentRemoveOrphanedRequest,
    AttachmentRemoveRequest,
    AttachmentRenameRequest,
)
from services.uow import UnitOfWork

router = APIRouter()
logger = logging.getLogger("amtodo")
SettingsDep = Annotated[AppSettings, Depends(get_settings)]
UowDep = Annotated[UnitOfWork, Depends(get_uow)]
ClockDep = Annotated[Clock, Depends(get_clock)]


def _resolve_owner(body) -> tuple[str, int]:
    """Return (owner_type, owner_id) from a body with todo_id/schedule_id."""
    if body.todo_id is not None:
        return "todo", body.todo_id
    return "schedule", body.schedule_id


def _changelog_service(uow: UnitOfWork, owner_type: str):
    return uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service


def _dict_fn(owner_type: str):
    return attachment_to_dict if owner_type == "todo" else schedule_attachment_to_dict


@router.post("/attachment/init-upload")
def init_upload_attachment(
    body: AttachmentInitUploadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create a one-time token for an authenticated attachment upload."""
    service = make_attachment_service(uow, clock, request, body.owner_type)
    service.list_for_owner(body.owner_id)
    upload_token_store = request.app.state.upload_token_store
    token = upload_token_store.create(
        owner_type=body.owner_type,
        owner_id=body.owner_id,
        user_id=uow.user_id,
        filename=body.filename,
        mime_type=body.mime_type,
        plain_size=body.plain_size,
        plain_sha256=body.plain_sha256,
    )
    return {"ok": True, "token": token}


@router.post("/attachment/list")
def list_attachments(
    body: AttachmentListRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List attachment metadata for a ToDo or Schedule."""
    owner_type, owner_id = _resolve_owner(body)
    service = make_attachment_service(uow, clock, request, owner_type, changelog_service=_changelog_service(uow, owner_type))
    attachments = service.list_for_owner(owner_id)
    dict_fn = _dict_fn(owner_type)
    return {
        "ok": True,
        "count": len(attachments),
        "attachments": [dict_fn(a, uow.user_id) for a in attachments],
    }


@router.post("/attachment/get")
def show_attachment(
    body: AttachmentGetRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return attachment metadata."""
    owner_type, owner_id = _resolve_owner(body)
    service = make_attachment_service(uow, clock, request, owner_type, changelog_service=_changelog_service(uow, owner_type))
    attachment = service.show(owner_id, body.attachment_id)
    return {"ok": True, "attachment": _dict_fn(owner_type)(attachment, uow.user_id)}


@router.post("/attachment/remove")
def remove_attachment(
    body: AttachmentRemoveRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove an attachment from a ToDo or Schedule."""
    owner_type, owner_id = _resolve_owner(body)
    service = make_attachment_service(uow, clock, request, owner_type, changelog_service=_changelog_service(uow, owner_type))
    attachment = service.remove(owner_id, body.attachment_id)
    return {"ok": True, "attachment": _dict_fn(owner_type)(attachment, uow.user_id)}


@router.post("/attachment/rename")
def rename_attachment(
    body: AttachmentRenameRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Rename an attachment's display filename."""
    owner_type, owner_id = _resolve_owner(body)
    service = make_attachment_service(uow, clock, request, owner_type, changelog_service=_changelog_service(uow, owner_type))
    attachment = service.rename(owner_id, body.attachment_id, body.filename)
    return {"ok": True, "attachment": _dict_fn(owner_type)(attachment, uow.user_id)}


@router.post("/attachment/remove-orphaned")
def remove_orphaned_attachments(
    body: AttachmentRemoveOrphanedRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove orphaned attachment metadata for a ToDo or Schedule."""
    owner_type, owner_id = _resolve_owner(body)
    service = make_attachment_service(uow, clock, request, owner_type, changelog_service=_changelog_service(uow, owner_type))
    count = service.remove_orphaned(owner_id)
    return {"ok": True, "count": count, "attachments": []}


@router.put("/attachment/upload")
async def stream_upload_attachment(request: Request, token: str):
    """Stream-upload an attachment file using a one-time upload token."""
    upload_token_store = request.app.state.upload_token_store
    settings_obj = request.app.state.settings

    # 1. Validate token
    tok = upload_token_store.get(token)
    if not tok:
        raise HTTPException(404, "Invalid or expired token")

    # 2. Reject resumable/ranged upload semantics explicitly.
    if request.headers.get("content-range") or request.headers.get("range"):
        upload_token_store.pop(token)
        raise HTTPException(400, "Resumable attachment upload is not supported")

    # 3. Check Content-Length header (fast reject)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            content_length_value = int(content_length)
        except ValueError:
            upload_token_store.pop(token)
            raise HTTPException(400, "Invalid Content-Length")
        if content_length_value > settings_obj.max_attachment_size_bytes:
            upload_token_store.pop(token)
            raise HTTPException(413, "File too large")

    # 4. Stream to temp file with byte counter
    temp_path = tok.temp_path
    total = 0
    try:
        with open(temp_path, "wb") as f:
            async for chunk in request.stream():
                total += len(chunk)
                if total > settings_obj.max_attachment_size_bytes:
                    raise HTTPException(413, "File too large")
                f.write(chunk)
    except HTTPException:
        temp_path.unlink(missing_ok=True)
        upload_token_store.pop(token)
        raise
    except Exception:
        temp_path.unlink(missing_ok=True)
        upload_token_store.pop(token)
        raise

    # 5. Finalize -- remove token, keep temp file
    tok_final = upload_token_store.finalize(token)
    if not tok_final:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(408, "Token expired during upload")

    # 6. Service creates metadata + moves file to final location
    from clock import SystemClock

    clock = SystemClock()
    db = request.app.state.db

    try:
        with UnitOfWork(db, tok_final.user_id) as uow:
            svc = make_attachment_service(uow, clock, request, tok_final.owner_type)
            attachment = svc.create_from_upload(
                owner_id=tok_final.owner_id,
                upload_path=temp_path,
                content_size=total,
                filename=tok_final.filename,
                mime_type=tok_final.mime_type,
                plain_sha256=tok_final.plain_sha256,
            )
            uow.session.flush()
            dict_fn = _dict_fn(tok_final.owner_type)
            result = {"ok": True, "attachment": dict_fn(attachment, uow.user_id)}
    except Exception:
        logger.exception(
            "Attachment upload finalize failed: user_id=%s owner_type=%s owner_id=%s "
            "filename=%r bytes=%s temp_path=%s",
            tok_final.user_id,
            tok_final.owner_type,
            tok_final.owner_id,
            tok_final.filename,
            total,
            temp_path,
        )
        temp_path.unlink(missing_ok=True)
        raise

    return JSONResponse(result)


@router.get("/attachment/{owner_type}/{owner_id}/{attachment_id}/download")
async def stream_download_attachment_bearer(
    owner_type: str,
    owner_id: int,
    attachment_id: int,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
):
    """Stream-download an attachment using the user's Bearer token."""
    if owner_type not in {"todo", "schedule"}:
        raise HTTPException(404, "Invalid attachment owner type")
    svc = make_attachment_service(uow, clock, request, owner_type)
    attachment = svc.show(owner_id, attachment_id)
    content_path = svc.storage_path(attachment)
    if not content_path.exists():
        raise HTTPException(404, "File not found")

    return _stream_attachment_file(attachment, content_path, request)


def _stream_attachment_file(attachment, content_path: Path, request: Request) -> StreamingResponse:
    """Build a full or byte-range streaming response for an attachment file."""
    safe_name = attachment.filename.encode("ascii", errors="replace").decode("ascii")
    media_type = _download_media_type(attachment.mime_type, attachment.filename)
    file_size = content_path.stat().st_size
    common_headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'attachment; filename="{safe_name}"',
        "X-AMToDo-Content-SHA256": attachment.plain_sha256,
        "X-AMToDo-Content-Length": str(file_size),
        "X-AMToDo-Updated-At": str(attachment.updated_at),
    }

    range_header = request.headers.get("range")
    byte_range = _parse_range_header(range_header, file_size)
    if range_header and byte_range is None:
        raise HTTPException(
            status_code=416,
            detail="Invalid range",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    if byte_range is not None:
        start, end = byte_range
        length = end - start + 1
        return StreamingResponse(
            _file_iterator(content_path, start=start, length=length),
            status_code=206,
            media_type=media_type,
            headers={
                **common_headers,
                "Content-Length": str(length),
                "Content-Range": f"bytes {start}-{end}/{file_size}",
            },
        )

    return StreamingResponse(
        _file_iterator(content_path),
        media_type=media_type,
        headers={
            **common_headers,
            "Content-Length": str(file_size),
        },
    )


def _parse_range_header(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    if not range_header:
        return None
    unit, _, value = range_header.partition("=")
    if unit.strip().lower() != "bytes" or "," in value:
        return None
    start_s, sep, end_s = value.strip().partition("-")
    if sep != "-":
        return None
    try:
        if start_s == "":
            suffix = int(end_s)
            if suffix <= 0:
                return None
            start = max(file_size - suffix, 0)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
    except ValueError:
        return None
    if start < 0 or end < start or start >= file_size:
        return None
    return start, min(end, file_size - 1)


def _download_media_type(stored_mime_type: str | None, filename: str) -> str:
    if stored_mime_type and stored_mime_type != "application/octet-stream":
        return stored_mime_type
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or stored_mime_type or "application/octet-stream"


def _file_iterator(path: Path, chunk_size: int = 65536, start: int = 0, length: int | None = None):
    remaining = length
    with open(path, "rb") as f:
        if start:
            f.seek(start)
        while remaining is None or remaining > 0:
            read_size = chunk_size if remaining is None else min(chunk_size, remaining)
            chunk = f.read(read_size)
            if not chunk:
                break
            if remaining is not None:
                remaining -= len(chunk)
            yield chunk
