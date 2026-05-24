"""Encrypted attachment service boundaries."""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from exceptions import NotFoundError, ValidationError

logger = logging.getLogger("amtodo")

if TYPE_CHECKING:
    from clock import Clock
    from repositories import (
        ScheduleAttachmentRepository,
        ScheduleRepository,
        TodoAttachmentRepository,
        TodoRepository,
    )

ENCRYPTION_ALG = "AES-128-CTR-HMAC-SHA256"


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
        changelog_service=None,
    ) -> None:
        self._repository = repository
        self._owner_repository = owner_repository
        self._clock = clock
        self._model = model_class
        self._storage_root = storage_root
        self._user_id = user_id
        self._owner_type = owner_type
        self._changelog = changelog_service

    def create_from_cipher(
        self,
        owner_id: int,
        cipher_path: Path,
        cipher_size: int,
        filename: str,
        mime_type: str | None,
        file_key: str,
        hmac_key: str,
        nonce: str,
        plain_size: int,
    ) -> object:
        """Create attachment from pre-encrypted cipher file (client-side encryption).

        Phase 1: create metadata row and flush to obtain attachment.id.
        Phase 2: generate storage path from id, move cipher file, update storage_path.
        """

        # 1. Validate owner exists
        self._require_owner(owner_id)

        # 2. Clean filename, guess MIME, determine preview_kind
        clean_name = _clean_filename(filename)
        resolved_mime = (
            mime_type
            or mimetypes.guess_type(clean_name)[0]
            or "application/octet-stream"
        )
        preview_kind = _preview_kind(resolved_mime)

        # 3. Compute cipher_sha256 by streaming hash over cipher_path
        cipher_sha256 = _sha256_hex_file(cipher_path)

        # 4. Get next_file_index
        file_index = self._repository.next_file_index(owner_id)
        now = self._clock.now_epoch()

        # 5. Insert metadata row with client-provided encryption params
        owner_field = f"{self._owner_type}_id"
        attachment = self._model(
            **{
                owner_field: owner_id,
                "file_index": file_index,
                "filename": clean_name,
                "mime_type": resolved_mime,
                "preview_kind": preview_kind,
                "plain_size_bytes": plain_size,
                "cipher_size_bytes": cipher_size,
                "plain_sha256": "",  # server doesn't know plaintext
                "cipher_sha256": cipher_sha256,
                "file_key": file_key,
                "nonce": nonce,
                "encryption_alg": ENCRYPTION_ALG,
                "storage_path": "",
                "created_at": now,
                "updated_at": now,
            }
        )

        # 6. Flush to get attachment.id
        attachment = self._repository.add(attachment)
        self._repository.flush()

        # 7. Move cipher file to final storage location
        relative_path = (
            Path(self._owner_type)
            / str(self._user_id)
            / str(owner_id)
            / f"{attachment.id}.bin"
        )
        absolute_path = self._storage_root / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(cipher_path), str(absolute_path))

        # 8. Update storage_path, touch owner's updated_at
        attachment.storage_path = str(relative_path)
        self._touch_owner(owner_id)
        if self._changelog:
            from serialization import attachment_to_dict, schedule_attachment_to_dict
            if self._owner_type == "todo":
                meta = attachment_to_dict(attachment, self._user_id)
            else:
                meta = schedule_attachment_to_dict(attachment, self._user_id)
            self._changelog.record_attachment_add(owner_id, meta)

        # 9. Return attachment
        return attachment

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
        if attachment.is_orphaned is False:
            path = self.encrypted_path(attachment)
            if not path.is_file():
                attachment.is_orphaned = True
                self._repository.update(attachment)
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
        """Remove attachment metadata and encrypted file from storage.

        File deletion failures are logged but do not prevent DB metadata removal.
        """

        attachment = self.show(owner_id, attachment_id)
        if self._changelog:
            from serialization import attachment_to_dict, schedule_attachment_to_dict
            if self._owner_type == "todo":
                meta = attachment_to_dict(attachment, self._user_id)
            else:
                meta = schedule_attachment_to_dict(attachment, self._user_id)
            self._changelog.record_attachment_remove(owner_id, meta)
        path = self.encrypted_path(attachment)
        try:
            if path.exists():
                path.unlink()
        except OSError:
            logger.warning(
                "Failed to delete attachment file: %s (attachment #%d)",
                path, attachment_id,
            )
        self._repository.remove(attachment)
        self._touch_owner(owner_id)
        return attachment

    def rename(self, owner_id: int, attachment_id: int, new_filename: str) -> object:
        """Rename an attachment's display filename."""

        attachment = self.show(owner_id, attachment_id)
        clean_name = _clean_filename(new_filename)

        from serialization import attachment_to_dict, schedule_attachment_to_dict
        dict_fn = attachment_to_dict if self._owner_type == "todo" else schedule_attachment_to_dict
        old_meta = dict_fn(attachment, self._user_id)

        attachment.filename = clean_name
        attachment.updated_at = self._clock.now_epoch()
        self._repository.update(attachment)

        new_meta = dict_fn(attachment, self._user_id)
        if self._changelog:
            self._changelog.record_attachment_rename(owner_id, old_meta, new_meta)

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

    def _touch_owner(self, owner_id: int) -> None:
        owner = self._owner_repository.get(owner_id)
        if owner is None:
            raise NotFoundError(f"{self._owner_type} #{owner_id} was not found")
        owner.updated_at = self._clock.now_epoch()


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


def _sha256_hex_file(path: Path) -> str:
    """Compute SHA-256 hex digest by streaming over a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()
