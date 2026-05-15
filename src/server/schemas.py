"""Pydantic request models for FastAPI endpoints.

All POST request bodies include an auth field:
  - Admin endpoints: ``admin_token``
  - User endpoints:  ``access_token``
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# ── Auth mixins ──

class AdminAuthMixin(BaseModel):
    admin_token: str


class UserAuthMixin(BaseModel):
    access_token: str


# ── Admin ──

class AdminInitDbRequest(AdminAuthMixin):
    pass


class AdminConfigRequest(AdminAuthMixin):
    pass


# ── User ──

class UserMeRequest(UserAuthMixin):
    pass


# ── ToDo ──

class TodoListRequest(UserAuthMixin):
    start_at: int | None = None
    end_at: int | None = None
    open_only: bool = False
    completed_only: bool = False


class TodoSearchRequest(UserAuthMixin):
    query: str = ""
    use_regex: bool = False
    ignore_case: bool = True
    fields: list[str] = Field(default_factory=lambda: ["title", "description", "tag"])
    start_at: int | None = None
    end_at: int | None = None
    planned_start_at: int | None = None
    planned_end_at: int | None = None
    due_start_at: int | None = None
    due_end_at: int | None = None
    created_start_at: int | None = None
    created_end_at: int | None = None
    open_only: bool = False
    completed_only: bool = False
    updated_start_at: int | None = None
    updated_end_at: int | None = None
    completed: bool | None = None
    priority_min: int | None = Field(default=None, ge=0)
    priority_max: int | None = Field(default=None, ge=0)
    tag: str | None = None
    sort_by: str = "updated_at"
    sort_order: str = "desc"
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class TodoStatsRequest(UserAuthMixin):
    start_at: int | None = None
    end_at: int | None = None


class TodoCreateRequest(UserAuthMixin):
    title: str
    planned_at: int | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int = Field(default=0, ge=0)
    tag: str | None = None


class TodoGetRequest(UserAuthMixin):
    todo_id: int


class TodoUpdateRequest(UserAuthMixin):
    todo_id: int
    title: str | None = None
    planned_at: int | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int | None = Field(default=None, ge=0)
    tag: str | None = None


class TodoTargetsRequest(UserAuthMixin):
    targets: list[int]


class TodoAttachmentListRequest(UserAuthMixin):
    todo_id: int


class TodoAttachmentGetRequest(UserAuthMixin):
    todo_id: int
    attachment_id: int


class TodoAttachmentUploadRequest(UserAuthMixin):
    todo_id: int
    filename: str
    content_base64: str
    mime_type: str | None = None


class TodoAttachmentDownloadRequest(UserAuthMixin):
    todo_id: int
    attachment_id: int


class TodoAttachmentRemoveRequest(UserAuthMixin):
    todo_id: int
    attachment_id: int


class TodoAttachmentRemoveOrphanedRequest(UserAuthMixin):
    todo_id: int


# ── Schedule Attachments ──

class ScheduleAttachmentListRequest(UserAuthMixin):
    schedule_id: int


class ScheduleAttachmentGetRequest(UserAuthMixin):
    schedule_id: int
    attachment_id: int


class ScheduleAttachmentUploadRequest(UserAuthMixin):
    schedule_id: int
    filename: str
    content_base64: str
    mime_type: str | None = None


class ScheduleAttachmentDownloadRequest(UserAuthMixin):
    schedule_id: int
    attachment_id: int


class ScheduleAttachmentRemoveRequest(UserAuthMixin):
    schedule_id: int
    attachment_id: int


class ScheduleAttachmentRemoveOrphanedRequest(UserAuthMixin):
    schedule_id: int


# ── Schedule ──

class ScheduleListRequest(UserAuthMixin):
    start_at: int | None = None
    end_at: int | None = None


class ScheduleSearchRequest(UserAuthMixin):
    query: str = ""
    use_regex: bool = False
    ignore_case: bool = True
    fields: list[str] = Field(
        default_factory=lambda: ["title", "description", "location", "category"]
    )
    start_at: int | None = None
    end_at: int | None = None
    created_start_at: int | None = None
    created_end_at: int | None = None
    updated_start_at: int | None = None
    updated_end_at: int | None = None
    category: str | None = None
    location: str | None = None
    sort_by: str = "updated_at"
    sort_order: str = "desc"
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class ScheduleStatsRequest(UserAuthMixin):
    start_at: int | None = None
    end_at: int | None = None


class ScheduleConflictsRequest(UserAuthMixin):
    start_at: int
    end_at: int
    exclude_id: int | None = None


class ScheduleCreateRequest(UserAuthMixin):
    title: str
    start_at: int
    end_at: int
    description: str | None = None
    location: str | None = None
    category: str | None = None


class ScheduleGetRequest(UserAuthMixin):
    schedule_id: int


class ScheduleUpdateRequest(UserAuthMixin):
    schedule_id: int
    title: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    description: str | None = None
    location: str | None = None
    category: str | None = None


class ScheduleTargetsRequest(UserAuthMixin):
    targets: list[int]
