"""Schedule API routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends

from config import AppSettings
from exceptions import AMToDoError
from serialization import schedule_to_dict
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
    TargetsRequest,
)
from services import (
    ScheduleDraft,
    ScheduleService,
    ScheduleUpdate,
)
from services.uow import UnitOfWork
from clock import Clock

if TYPE_CHECKING:
    from models import Schedule

router = APIRouter()


# ── static paths (must be before parameterized paths) ──

@router.post("")
def create_schedule(
    body: ScheduleCreateRequest,
    settings: AppSettings = Depends(get_settings),
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Create a schedule item."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedule = service.create(
        ScheduleDraft(
            title=body.title,
            start_at=body.start_at,
            end_at=body.end_at,
            timezone=settings.timezone,
            description=body.description,
            location=body.location,
            category=body.category,
        )
    )
    uow.session.flush()
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.get("")
def list_schedules(
    start_at: int | None = None,
    end_at: int | None = None,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """List schedules overlapping an epoch range."""
    resolved_start_at = start_at if start_at is not None else clock.now_epoch()
    resolved_end_at = end_at if end_at is not None else resolved_start_at + 86_400

    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedules = service.list_between(resolved_start_at, resolved_end_at)

    return {
        "ok": True,
        "range": {"start_at": resolved_start_at, "end_at": resolved_end_at},
        "count": len(schedules),
        "schedules": [schedule_to_dict(schedule) for schedule in schedules],
    }


@router.get("/search")
def search_schedules(
    pattern: str,
    start_at: int | None = None,
    end_at: int | None = None,
    ignore_case: bool = False,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Search schedules with a regular expression."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedules = service.search(
        pattern,
        start_at=start_at,
        end_at=end_at,
        case_sensitive=not ignore_case,
    )

    return {
        "ok": True,
        "pattern": pattern,
        "case_sensitive": not ignore_case,
        "range": {"start_at": start_at, "end_at": end_at},
        "count": len(schedules),
        "schedules": [schedule_to_dict(schedule) for schedule in schedules],
    }


@router.get("/conflicts")
def check_conflicts(
    start_at: int,
    end_at: int,
    exclude_id: int | None = None,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Check schedule conflicts without creating an item."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    conflicts = service.conflicts(start_at, end_at, exclude_id=exclude_id)

    return {
        "ok": True,
        "range": {"start_at": start_at, "end_at": end_at},
        "exclude_id": exclude_id,
        "conflict": bool(conflicts),
        "count": len(conflicts),
        "schedules": [schedule_to_dict(schedule) for schedule in conflicts],
    }


@router.get("/stats")
def schedule_stats(
    start_at: int | None = None,
    end_at: int | None = None,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Return schedule statistics."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    stats = service.stats(start_at=start_at, end_at=end_at)
    return {"ok": True, "range": {"start_at": start_at, "end_at": end_at}, "stats": stats}


@router.post("/remove")
def remove_schedules(
    body: TargetsRequest,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Remove one or more schedules by id."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    results = [
        _target_result(target, lambda current: service.remove(current))
        for target in _unique_targets(body.targets)
    ]
    return {"ok": all(result["ok"] for result in results), "results": results}


# ── parameterized paths ──

@router.get("/{schedule_id}")
def show_schedule(
    schedule_id: int,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Show a schedule by id."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedule = service.show(schedule_id)
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.patch("/{schedule_id}")
def update_schedule(
    schedule_id: int,
    body: ScheduleUpdateRequest,
    uow: UnitOfWork = Depends(get_uow),
    clock: Clock = Depends(get_clock),
) -> dict[str, object]:
    """Update mutable schedule fields."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedule = service.update(
        schedule_id,
        ScheduleUpdate(
            title=body.title,
            start_at=body.start_at,
            end_at=body.end_at,
            description=body.description,
            location=body.location,
            category=body.category,
        ),
    )
    uow.session.flush()
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


# ── helpers ──

def _unique_targets(targets: list[int]) -> list[int]:
    return list(dict.fromkeys(targets))


def _target_result(
    target: int,
    operation: Callable[[int], "Schedule"],
) -> dict[str, object]:
    try:
        schedule = operation(target)
    except AMToDoError as exc:
        return {
            "target": target,
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    return {"target": target, "ok": True, "schedule": schedule_to_dict(schedule)}
