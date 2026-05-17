# src/server/notifications.py
"""Notification API routes."""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends

from clock import Clock
from config import AppSettings
from serialization import notification_to_dict
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    NotificationChangelogQueryRequest,
    NotificationCreateRequest,
    NotificationGetRequest,
    NotificationListRequest,
    NotificationListTriggeredRequest,
    NotificationRemoveRequest,
    NotificationTrashDeleteRequest,
    NotificationTrashRestoreRequest,
    NotificationUpdateRequest,
    UserAuthMixin,
)
from services import NotificationDraft, NotificationService, NotificationUpdate
from services.uow import UnitOfWork

router = APIRouter()
SettingsDep = Annotated[AppSettings, Depends(get_settings)]
UowDep = Annotated[UnitOfWork, Depends(get_uow)]
ClockDep = Annotated[Clock, Depends(get_clock)]


def _make_service(uow: UnitOfWork, clock: Clock) -> NotificationService:
    return NotificationService(
        uow.notifications,
        uow.notification_mentions,
        clock,
        uow.notification_model,
        uow.notification_mention_model,
        changelog_service=uow.notification_changelog_service,
    )


@router.post("/create")
def create_notification(
    body: NotificationCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    draft = NotificationDraft(
        title=body.title,
        trigger_at=body.trigger_at,
        description=body.description,
        mentions=[{"target_type": m.target_type, "target_id": m.target_id} for m in body.mentions],
    )
    notification = service.create(draft)
    mentions = service.get_mentions(notification.id)
    return {"ok": True, "notification": notification_to_dict(notification, mentions)}


@router.post("/get")
def get_notification(
    body: NotificationGetRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    notification = service.show(body.notification_id)
    mentions = service.get_mentions(notification.id)
    return {"ok": True, "notification": notification_to_dict(notification, mentions)}


@router.post("/update")
def update_notification(
    body: NotificationUpdateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    fields_set: set[str] = set()
    if body.title is not None:
        fields_set.add("title")
    if body.description is not None:
        fields_set.add("description")
    if body.trigger_at is not None:
        fields_set.add("trigger_at")
    if body.mentions is not None:
        fields_set.add("mentions")
    update = NotificationUpdate(
        title=body.title,
        description=body.description,
        trigger_at=body.trigger_at,
        mentions=[{"target_type": m.target_type, "target_id": m.target_id} for m in body.mentions] if body.mentions is not None else None,
        _fields_set=frozenset(fields_set),
    )
    notification = service.update(body.notification_id, update)
    mentions = service.get_mentions(notification.id)
    return {"ok": True, "notification": notification_to_dict(notification, mentions)}


@router.post("/remove")
def remove_notification(
    body: NotificationRemoveRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    service.remove(body.notification_id)
    return {"ok": True}


@router.post("/list")
def list_notifications(
    body: NotificationListRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    notifications = service.list_between(body.start_at, body.end_at)
    result = []
    for n in notifications:
        mentions = service.get_mentions(n.id)
        result.append(notification_to_dict(n, mentions))
    return {"ok": True, "count": len(result), "notifications": result}


@router.post("/list_triggered")
def list_triggered_notifications(
    body: NotificationListTriggeredRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    now = int(time.time())
    notifications = service.list_triggered(body.after, now)
    result = []
    for n in notifications:
        mentions = service.get_mentions(n.id)
        result.append(notification_to_dict(n, mentions))
    return {"ok": True, "count": len(result), "notifications": result}


@router.post("/trash/list")
def list_deleted_notifications(
    body: UserAuthMixin,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    notifications = service.list_deleted()
    result = []
    for n in notifications:
        mentions = service.get_mentions(n.id)
        result.append(notification_to_dict(n, mentions))
    return {"ok": True, "count": len(result), "notifications": result}


@router.post("/trash/restore")
def restore_notification(
    body: NotificationTrashRestoreRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    service.restore(body.notification_id)
    return {"ok": True}


@router.post("/trash/delete")
def purge_notification(
    body: NotificationTrashDeleteRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = _make_service(uow, clock)
    service.purge(body.notification_id)
    return {"ok": True}


def _changelog_entry_to_dict(entry: object) -> dict[str, object]:
    import json
    return {
        "id": entry.id,
        "entity_id": entry.entity_id,
        "action": entry.action,
        "changed_fields": json.loads(entry.changed_fields),
        "before_snapshot": json.loads(entry.before_snapshot) if entry.before_snapshot else None,
        "after_snapshot": json.loads(entry.after_snapshot) if entry.after_snapshot else None,
        "created_at": entry.created_at,
    }


@router.post("/changelog")
def notification_changelog(
    body: NotificationChangelogQueryRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    service = uow.notification_changelog_service
    entries, total = service.query(
        entity_id=body.entity_id,
        action=body.action,
        start_at=body.start_at,
        end_at=body.end_at,
        limit=body.limit,
        offset=body.offset,
    )
    return {
        "ok": True,
        "total": total,
        "entries": [_changelog_entry_to_dict(entry) for entry in entries],
    }
