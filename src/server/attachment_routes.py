"""Unified attachment API routes."""

from __future__ import annotations

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
    AttachmentListRequest,
    AttachmentRemoveOrphanedRequest,
    AttachmentRemoveRequest,
    AttachmentRenameRequest,
)
from services.uow import UnitOfWork

router = APIRouter()
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


@router.post("/attachment/list")
def list_attachments(
    body: AttachmentListRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List encrypted attachment metadata for a ToDo or Schedule."""
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
    """Return encrypted attachment metadata."""
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
    """Stream-upload a pre-encrypted cipher file using a one-time upload token."""
    upload_token_store = request.app.state.upload_token_store
    settings_obj = request.app.state.settings

    # 1. Validate token
    tok = upload_token_store.get(token)
    if not tok:
        raise HTTPException(404, "Invalid or expired token")

    # 2. Check Content-Length header (fast reject)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings_obj.max_attachment_size_bytes + 32:
        upload_token_store.pop(token)
        raise HTTPException(413, "File too large")

    # 3. Stream to temp file with byte counter
    temp_path = tok.temp_path
    total = 0
    try:
        with open(temp_path, "wb") as f:
            async for chunk in request.stream():
                total += len(chunk)
                if total > settings_obj.max_attachment_size_bytes + 32:
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

    # 4. Finalize -- remove token, keep temp file
    tok_final = upload_token_store.finalize(token)
    if not tok_final:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(408, "Token expired during upload")

    # 5. Service creates metadata + moves file to final location
    from clock import SystemClock

    clock = SystemClock()
    db = request.app.state.db

    with UnitOfWork(db, tok_final.user_id) as uow:
        svc = make_attachment_service(uow, clock, request, tok_final.owner_type)
        attachment = svc.create_from_cipher(
            owner_id=tok_final.owner_id,
            cipher_path=temp_path,
            cipher_size=total,
            filename=tok_final.filename,
            mime_type=tok_final.mime_type,
            file_key=tok_final.file_key,
            hmac_key=tok_final.hmac_key,
            nonce=tok_final.nonce,
            plain_size=tok_final.plain_size,
        )
        uow.session.flush()
        dict_fn = _dict_fn(tok_final.owner_type)
        result = {"ok": True, "attachment": dict_fn(attachment, uow.user_id)}

    return JSONResponse(result)


@router.get("/attachment/{attachment_id}/download")
async def stream_download_attachment(
    attachment_id: int,
    token: str,
    request: Request,
):
    """Stream-download an encrypted attachment using a one-time download token."""
    download_token_store = request.app.state.download_token_store

    # 1. Validate token
    tok = download_token_store.get(token)
    if not tok:
        raise HTTPException(404, "Invalid or expired token")

    # 2. Resolve attachment
    from clock import SystemClock

    clock = SystemClock()
    db = request.app.state.db

    with UnitOfWork(db, tok.user_id) as uow:
        svc = make_attachment_service(uow, clock, request, tok.owner_type)
        attachment = svc.show(tok.owner_id, tok.attachment_id)
        cipher_path = svc.encrypted_path(attachment)

    if not cipher_path.exists():
        raise HTTPException(404, "File not found")

    # 3. Stream cipher file back
    safe_name = attachment.filename.encode("ascii", errors="replace").decode("ascii")

    return StreamingResponse(
        _file_iterator(cipher_path),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.enc"',
            "Content-Length": str(attachment.cipher_size_bytes),
            "X-AMToDo-Cipher-SHA256": attachment.cipher_sha256,
            "X-AMToDo-Updated-At": str(attachment.updated_at),
        },
    )


def _file_iterator(path: Path, chunk_size: int = 65536):
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            yield chunk
