"""Encrypted ToDo attachment service boundaries."""

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
from models import TodoAttachment

if TYPE_CHECKING:
    from clock import Clock
    from repositories import AttachmentRepository, TodoRepository

ENCRYPTION_ALG = "AES-256-GCM"


@dataclass(frozen=True, slots=True)
class AttachmentDraft:
    """Input data for creating a ToDo attachment."""

    filename: str
    content: bytes
    mime_type: str | None = None


class AttachmentService:
    """Coordinates encrypted attachment use cases."""

    def __init__(
        self,
        repository: AttachmentRepository,
        todo_repository: TodoRepository,
        clock: Clock,
        model_class: type,
        storage_root: Path,
        user_id: int,
    ) -> None:
        self._repository = repository
        self._todo_repository = todo_repository
        self._clock = clock
        self._model = model_class
        self._storage_root = storage_root
        self._user_id = user_id

    def create(self, todo_id: int, draft: AttachmentDraft) -> TodoAttachment:
        """Encrypt and store a file attachment for a ToDo."""

        self._require_todo(todo_id)
        filename = _clean_filename(draft.filename)
        if not draft.content:
            raise ValidationError("attachment content cannot be empty")

        mime_type = (
            draft.mime_type
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        )
        preview_kind = _preview_kind(mime_type)
        file_index = self._repository.next_file_index(todo_id)
        key = secrets.token_bytes(32)
        nonce = secrets.token_bytes(12)
        cipher = AESGCM(key).encrypt(nonce, draft.content, None)
        now = self._clock.now_epoch()
        relative_path = (
            Path("db")
            / "attachment"
            / str(self._user_id)
            / str(todo_id)
            / str(file_index)
        )
        absolute_path = self._storage_root / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        absolute_path.write_bytes(cipher)

        attachment = self._model(
            todo_id=todo_id,
            file_index=file_index,
            filename=filename,
            mime_type=mime_type,
            preview_kind=preview_kind,
            plain_size_bytes=len(draft.content),
            cipher_size_bytes=len(cipher),
            plain_sha256=_sha256_hex(draft.content),
            cipher_sha256=_sha256_hex(cipher),
            file_key=_b64(key),
            nonce=_b64(nonce),
            encryption_alg=ENCRYPTION_ALG,
            storage_path=str(relative_path),
            created_at=now,
            updated_at=now,
        )
        return self._repository.add(attachment)

    def list_for_todo(self, todo_id: int) -> list[TodoAttachment]:
        """Return attachment metadata for a ToDo."""

        self._require_todo(todo_id)
        return self._repository.list_for_todo(todo_id)

    def show(self, todo_id: int, attachment_id: int) -> TodoAttachment:
        """Return one attachment metadata row."""

        self._require_todo(todo_id)
        attachment = self._repository.get(attachment_id)
        if attachment is None or attachment.todo_id != todo_id:
            raise NotFoundError(f"attachment #{attachment_id} was not found")
        return attachment

    def encrypted_path(self, attachment: TodoAttachment) -> Path:
        """Return the absolute ciphertext path for an attachment."""

        return self._storage_root / Path(attachment.storage_path)

    def read_cipher(self, todo_id: int, attachment_id: int) -> bytes:
        """Return encrypted attachment bytes."""

        attachment = self.show(todo_id, attachment_id)
        path = self.encrypted_path(attachment)
        if not path.is_file():
            raise NotFoundError(f"attachment file #{attachment_id} was not found")
        return path.read_bytes()

    def remove(self, todo_id: int, attachment_id: int) -> TodoAttachment:
        """Remove attachment metadata and encrypted file from storage."""

        attachment = self.show(todo_id, attachment_id)
        path = self.encrypted_path(attachment)
        if path.exists():
            path.unlink()
        self._repository.remove(attachment)
        return attachment

    def _require_todo(self, todo_id: int) -> None:
        todo = self._todo_repository.get(todo_id)
        if todo is None:
            raise NotFoundError(f"todo #{todo_id} was not found")


def _clean_filename(filename: str) -> str:
    clean = Path(filename).name.strip()
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
