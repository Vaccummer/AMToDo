"""Pydantic request models for FastAPI endpoints.

All POST request bodies include an auth field:
  - Admin endpoints: ``admin_token``
  - User endpoints:  ``access_token``
"""

from __future__ import annotations

from typing import Literal

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


class AdminUserCreateRequest(AdminAuthMixin):
    name: str


class AdminUserListRequest(AdminAuthMixin):
    pass


class AdminUserDeleteRequest(AdminAuthMixin):
    user_id: int


class AdminUserUpdateRequest(AdminAuthMixin):
    user_id: int
    name: str


class AdminUserRegenTokenRequest(AdminAuthMixin):
    user_id: int


# ── User ──

class UserMeRequest(UserAuthMixin):
    pass


class UserTokenRegenerateRequest(UserAuthMixin):
    pass


class UserUpdateRequest(UserAuthMixin):
    name: str


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
    after_id: int | None = None


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
    extra_fields: str = "{}"


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
    extra_fields: str | None = None


class TodoTargetsRequest(UserAuthMixin):
    targets: list[int]


# ── Batch Create/Update ──

class TodoCreateFields(BaseModel):
    """Fields for a single todo in a batch create request."""
    title: str
    description: str | None = None
    planned_at: int | None = None
    due_at: int | None = None
    priority: int = Field(default=0, ge=0)
    tag: str | None = None
    extra_fields: str = "{}"


class TodoBatchCreateRequest(UserAuthMixin):
    items: list[TodoCreateFields]


class TodoBatchUpdateItem(BaseModel):
    """Fields for a single todo in a batch update request."""
    id: int
    title: str | None = None
    description: str | None = None
    planned_at: int | None = None
    due_at: int | None = None
    priority: int | None = Field(default=None, ge=0)
    tag: str | None = None
    extra_fields: str | None = None


class TodoBatchUpdateRequest(UserAuthMixin):
    items: list[TodoBatchUpdateItem]


class TodoTrashListRequest(UserAuthMixin):
    query: str = ""
    use_regex: bool = False
    ignore_case: bool = True
    fields: list[str] = Field(default_factory=lambda: ["title", "description", "tag"])
    planned_start_at: int | None = None
    planned_end_at: int | None = None
    due_start_at: int | None = None
    due_end_at: int | None = None
    created_start_at: int | None = None
    created_end_at: int | None = None
    updated_start_at: int | None = None
    updated_end_at: int | None = None
    completed: bool | None = None
    priority_min: int | None = Field(default=None, ge=0)
    priority_max: int | None = Field(default=None, ge=0)
    tag: str | None = None
    sort_by: str = "updated_at"
    sort_order: str = "desc"
    limit: int = Field(default=50, ge=1, le=500)
    after_id: int | None = None


class TodoTrashRestoreRequest(UserAuthMixin):
    targets: list[int]


class TodoTrashDeleteRequest(UserAuthMixin):
    targets: list[int]


class TodoAttachmentListRequest(UserAuthMixin):
    todo_id: int


class TodoAttachmentGetRequest(UserAuthMixin):
    todo_id: int
    attachment_id: int


class AttachmentInitUploadRequest(UserAuthMixin):
    owner_type: Literal["todo", "schedule"]
    owner_id: int
    filename: str
    mime_type: str | None = None
    file_key: str             # base64
    hmac_key: str             # base64
    nonce: str                # base64
    plain_size: int


class AttachmentInitDownloadRequest(UserAuthMixin):
    owner_type: Literal["todo", "schedule"]
    owner_id: int
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
    after_id: int | None = None


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
    extra_fields: str = "{}"


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
    extra_fields: str | None = None


class ScheduleTargetsRequest(UserAuthMixin):
    targets: list[int]


class ScheduleCreateFields(BaseModel):
    """Fields for a single schedule in a batch create request."""
    title: str
    description: str | None = None
    start_at: int
    end_at: int
    location: str | None = None
    category: str | None = None
    extra_fields: str = "{}"


class ScheduleBatchCreateRequest(UserAuthMixin):
    items: list[ScheduleCreateFields]


class ScheduleBatchUpdateItem(BaseModel):
    """Fields for a single schedule in a batch update request."""
    id: int
    title: str | None = None
    description: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    location: str | None = None
    category: str | None = None
    extra_fields: str | None = None


class ScheduleBatchUpdateRequest(UserAuthMixin):
    items: list[ScheduleBatchUpdateItem]


class ScheduleTrashListRequest(UserAuthMixin):
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
    after_id: int | None = None


class ScheduleTrashRestoreRequest(UserAuthMixin):
    targets: list[int]


class ScheduleTrashDeleteRequest(UserAuthMixin):
    targets: list[int]


# ── Changelog ──

class TodoChangelogQueryRequest(UserAuthMixin):
    entity_id: int | None = None
    action: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    limit: int = Field(default=50, ge=1, le=500)
    after_id: int | None = None


class ScheduleChangelogQueryRequest(UserAuthMixin):
    entity_id: int | None = None
    action: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    limit: int = Field(default=50, ge=1, le=500)
    after_id: int | None = None


class NotificationChangelogQueryRequest(UserAuthMixin):
    entity_id: int | None = None
    action: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    limit: int = Field(default=50, ge=1, le=500)
    after_id: int | None = None


# -- Notification --

class NotificationMentionInput(BaseModel):
    target_type: Literal["todo", "schedule"]
    target_id: int


class NotificationCreateRequest(UserAuthMixin):
    title: str
    trigger_at: int
    description: str | None = None
    extra_fields: str = "{}"
    mentions: list[NotificationMentionInput] = Field(default_factory=list)


class NotificationGetRequest(UserAuthMixin):
    notification_id: int


class NotificationUpdateRequest(UserAuthMixin):
    notification_id: int
    title: str | None = None
    description: str | None = None
    trigger_at: int | None = None
    extra_fields: str | None = None
    mentions: list[NotificationMentionInput] | None = None


class NotificationRemoveRequest(UserAuthMixin):
    notification_id: int


class NotificationListRequest(UserAuthMixin):
    start_at: int | None = None
    end_at: int | None = None


class NotificationListTriggeredRequest(UserAuthMixin):
    after: int


class NotificationTrashRestoreRequest(UserAuthMixin):
    notification_id: int


class NotificationTrashDeleteRequest(UserAuthMixin):
    notification_id: int
