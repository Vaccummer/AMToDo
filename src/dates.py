"""Timezone-aware date helpers for date-scoped tasks."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from exceptions import ValidationError
from clock import epoch_to_datetime

if TYPE_CHECKING:
    from clock import Clock


TODAY = "today"
TOMORROW = "tomorrow"


def local_today(clock: Clock, timezone: str) -> date:
    """Return today's date in the configured timezone."""

    return epoch_to_datetime(clock.now_epoch(), timezone).date()


def parse_local_date(value: str, clock: Clock, timezone: str) -> date:
    """Parse a date value accepted by CLI and future UI forms."""

    normalized = value.strip().lower()
    today = local_today(clock, timezone)

    if normalized == TODAY:
        return today
    if normalized == TOMORROW:
        return today + timedelta(days=1)

    try:
        return date.fromisoformat(normalized)
    except ValueError as exc:
        msg = "date must be 'today', 'tomorrow', or YYYY-MM-DD"
        raise ValidationError(msg) from exc


def day_start_epoch(value: date, timezone: str) -> int:
    """Return the epoch timestamp for local midnight on a date."""

    start = datetime.combine(value, datetime.min.time(), tzinfo=ZoneInfo(timezone))
    return int(start.timestamp())


def day_after(value: date, days: int) -> date:
    """Return a date offset by whole days."""

    return value + timedelta(days=days)


def epoch_local_date(epoch: int, timezone: str) -> date:
    """Return the local date represented by an epoch timestamp."""

    return epoch_to_datetime(epoch, timezone).date()
