"""Background tasks for unified WebSocket notification push."""

from __future__ import annotations

import asyncio
import logging
import time

from serialization import notification_to_dict

logger = logging.getLogger("amtodo")


async def _notification_watcher(
    ws_mgr,
    db,
    token_map: dict[str, int],
    config: dict,
) -> None:
    """Query triggered notifications and push them over the unified WS."""

    from server.websocket_manager import NotificationResultCache

    interval = int(config.get("watcher_interval", 10))
    _watermarks: dict[int, int] = {}
    _cache = NotificationResultCache(ttl_seconds=interval * 0.8)
    _last_watermark_gc: float = time.monotonic()

    while True:
        await asyncio.sleep(interval)
        now_ts = int(time.time())
        active_users = set(ws_mgr.active_users)

        if time.monotonic() - _last_watermark_gc > 300:
            stale = [uid for uid in _watermarks if uid not in active_users]
            for uid in stale:
                del _watermarks[uid]
                _cache.evict(uid)
            _last_watermark_gc = time.monotonic()

        for user_id in active_users:
            last_check = _watermarks.get(user_id, now_ts - 60)
            notifications = _cache.get(user_id)

            if notifications is None:
                try:
                    notifications = _query_notifications(
                        db,
                        token_map,
                        user_id,
                        after=last_check,
                        now=now_ts,
                    )
                except Exception as exc:
                    logger.error(
                        "notification_watcher: query failed for user %d: %s",
                        user_id,
                        exc,
                    )
                    continue
                _cache.set(user_id, notifications)

            if notifications:
                for notification in notifications:
                    await ws_mgr.push_to_user(
                        user_id,
                        {
                            "type": "notification",
                            "data": notification_to_dict(notification),
                        },
                    )

            _watermarks[user_id] = now_ts


async def _heartbeat_task(ws_mgr, config: dict) -> None:
    """Periodically send ping messages to every active WebSocket."""

    interval = int(config.get("heartbeat_interval", 30))

    while True:
        await asyncio.sleep(interval)
        for user_id in list(ws_mgr.active_users):
            await ws_mgr.push_to_user(user_id, {"type": "ping"})


def _query_notifications(
    db,
    token_map: dict[str, int],
    user_id: int,
    *,
    after: int,
    now: int,
) -> list[object]:
    """Run a ``list_triggered`` query inside a per-user unit-of-work."""
    from server.notifications import make_notification_service
    from services.uow import UnitOfWork

    with UnitOfWork(db, user_id) as uow:
        svc = make_notification_service(uow)
        return svc.list_triggered(after=after, now=now)
