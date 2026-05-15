"""Encrypted attachment service boundaries."""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from exceptions import NotFoundError, ValidationError

if TYPE_CHECKING:
    from clock import Clock
    from repositories import (
        ScheduleAttachmentRepository,
        ScheduleRepository,
        TodoAttachmentRepository,
        TodoRepository,
    )

ENCRYPTION_ALG = "AES-256-GCM"


@dataclass(frozen=True, slots=True)
class AttachmentDraft:
    """Input data for creating an attachment."""

    filename: str
    content: bytes
    mime_type: str | None = None


class AttachmentService:
    """Coordinates encrypted attachment use cases for todos and schedules."""

    def __init__(
        self,
        repository: TodoAttachmentRepository | ScheduleAttachmentRepository,
        owner_repository: TodoRepository | ScheduleRepository,
        clock: Clock,
        model_class: type,
        storage_root: Path,
        user_id: int,
        owner_type: str,
    ) -> None:
        self._repository = repository
        self._owner_repository = owner_repository
        self._clock = clock
        self._model = model_class
        self._storage_root = storage_root
        self._user_id = user_id
        self._owner_type = owner_type

    def create(self, owner_id: int, draft: AttachmentDraft) -> object:
        """Encrypt and store a file attachment."""

        self._require_owner(owner_id)
        filename = _clean_filename(draft.filename)
        if not draft.content:
            raise ValidationError("attachment content cannot be empty")

        mime_type = (
            draft.mime_type
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        )
        preview_kind = _preview_kind(mime_type)
        file_index = self._repository.next_file_index(owner_id)
        key = secrets.token_bytes(32)
        nonce = secrets.token_bytes(12)
        cipher = AESGCM(key).encrypt(nonce, draft.content, None)
        now = self._clock.now_epoch()
        relative_path = (
            Path(self._owner_type)
            / str(self._user_id)
            / str(owner_id)
            / str(file_index)
        )
        absolute_path = self._storage_root / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        absolute_path.write_bytes(cipher)

        owner_field = f"{self._owner_type}_id"
        attachment = self._model(
            **{
                owner_field: owner_id,
                "file_index": file_index,
                "filename": filename,
                "mime_type": mime_type,
                "preview_kind": preview_kind,
                "plain_size_bytes": len(draft.content),
                "cipher_size_bytes": len(cipher),
                "plain_sha256": _sha256_hex(draft.content),
                "cipher_sha256": _sha256_hex(cipher),
                "file_key": _b64(key),
                "nonce": _b64(nonce),
                "encryption_alg": ENCRYPTION_ALG,
                "storage_path": str(relative_path),
                "created_at": now,
                "updated_at": now,
            }
        )
        return self._repository.add(attachment)

    def list_for_owner(self, owner_id: int) -> list[object]:
        """Return attachment metadata for an owner."""

        self._require_owner(owner_id)
        if self._owner_type == "todo":
            return self._repository.list_for_todo(owner_id)
        return self._repository.list_for_schedule(owner_id)

    def show(self, owner_id: int, attachment_id: int) -> object:
        """Return one attachment metadata row."""

        self._require_owner(owner_id)
        attachment = self._repository.get(attachment_id)
        owner_field = f"{self._owner_type}_id"
        if attachment is None or getattr(attachment, owner_field) != owner_id:
            raise NotFoundError(f"attachment #{attachment_id} was not found")
        return attachment

    def encrypted_path(self, attachment: object) -> Path:
        """Return the absolute ciphertext path for an attachment."""

        return self._storage_root / Path(attachment.storage_path)

    def read_cipher(self, owner_id: int, attachment_id: int) -> bytes:
        """Return encrypted attachment bytes."""

        attachment = self.show(owner_id, attachment_id)
        path = self.encrypted_path(attachment)
        if not path.is_file():
            attachment.is_orphaned = True
            self._repository.update(attachment)
            raise NotFoundError(f"attachment file #{attachment_id} is orphaned")
        return path.read_bytes()

    def remove(self, owner_id: int, attachment_id: int) -> object:
        """Remove attachment metadata and encrypted file from storage."""

        attachment = self.show(owner_id, attachment_id)
        path = self.encrypted_path(attachment)
        if path.exists():
            path.unlink()
        self._repository.remove(attachment)
        return attachment

    def remove_orphaned(self, owner_id: int) -> int:
        """Delete all orphaned attachments for an owner. Returns count removed."""

        self._require_owner(owner_id)
        attachments = self.list_for_owner(owner_id)
        orphaned = [a for a in attachments if a.is_orphaned]
        for a in orphaned:
            self._repository.remove(a)
        return len(orphaned)

    def _require_owner(self, owner_id: int) -> None:
        owner = self._owner_repository.get(owner_id)
        if owner is None:
            raise NotFoundError(f"{self._owner_type} #{owner_id} was not found")


def _clean_filename(filename: str) -> str:
    # Use string split to strip directory components in a platform-agnostic
    # way, avoiding Path() which can mishandle certain Unicode sequences.
    clean = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not clean:
        raise ValidationError("attachment filename cannot be empty")
    return clean


def _preview_kind(mime_type: str) -> str:
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("video/"):
        return "video"
    return "none"


def _sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _b64(content: bytes) -> str:
    return base64.b64encode(content).decode("ascii")
