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


class AdminUserListRequest(AdminAuthMixin):
    pass


class AdminUserCreateRequest(AdminAuthMixin):
    name: str


class AdminUserDeleteRequest(AdminAuthMixin):
    user_id: int


class AdminUserUpdateRequest(AdminAuthMixin):
    user_id: int
    name: str | None = None


class AdminUserRegenTokenRequest(AdminAuthMixin):
    user_id: int


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
    pattern: str
    start_at: int | None = None
    end_at: int | None = None
    planned_start_at: int | None = None
    planned_end_at: int | None = None
    created_start_at: int | None = None
    created_end_at: int | None = None
    ignore_case: bool = False
    open_only: bool = False
    completed_only: bool = False


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


# ── Schedule ──

class ScheduleListRequest(UserAuthMixin):
    start_at: int | None = None
    end_at: int | None = None


class ScheduleSearchRequest(UserAuthMixin):
    pattern: str
    start_at: int | None = None
    end_at: int | None = None
    ignore_case: bool = False


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
