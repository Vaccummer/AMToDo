"""Shared search, sort, and validation helpers for services."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from exceptions import ValidationError


_REGEX_MAX_PATTERN_LEN = 200
_REGEX_DANGEROUS = re.compile(r"(\+|\*)\1{3,}|(\([^)]*\))[+*]\2[+*]")


def compile_search_query(query: str, *, use_regex: bool, ignore_case: bool) -> re.Pattern[str]:
    """Compile a search query into a regex pattern."""
    flags = re.IGNORECASE if ignore_case else 0
    if use_regex:
        if len(query) > _REGEX_MAX_PATTERN_LEN:
            raise ValidationError(
                f"regex pattern too long ({len(query)} > {_REGEX_MAX_PATTERN_LEN})"
            )
        if _REGEX_DANGEROUS.search(query):
            raise ValidationError("regex pattern contains potentially catastrophic backtracking")
        pattern = query
    else:
        pattern = re.escape(query)
    try:
        return re.compile(pattern, flags=flags)
    except re.error as exc:
        msg = f"invalid regex pattern: {exc}"
        raise ValidationError(msg) from exc


def search_text(entity: object, fields: list[str]) -> str:
    """Extract searchable text from entity fields."""
    return "\n".join(
        str(value)
        for value in (getattr(entity, field) or "" for field in fields)
        if value
    )


def validate_fields(
    fields: list[str] | None,
    allowed: frozenset[str],
    label: str,
) -> list[str]:
    """Validate and resolve search fields."""
    resolved = list(fields) if fields is not None else sorted(allowed)
    if not resolved:
        raise ValidationError(f"{label} cannot be empty")
    unknown = sorted(set(resolved) - allowed)
    if unknown:
        raise ValidationError(f"unknown {label}: {', '.join(unknown)}")
    return resolved


def validate_sort(
    sort_by: str,
    sort_order: str,
    allowed: frozenset[str],
) -> None:
    """Validate sort parameters."""
    if sort_by not in allowed:
        raise ValidationError(f"unknown sort_by: {sort_by}")
    if sort_order not in {"asc", "desc"}:
        raise ValidationError("sort_order must be 'asc' or 'desc'")


def validate_optional_range(
    start_at: int | None,
    end_at: int | None,
    *,
    start_name: str,
    end_name: str,
) -> None:
    """Validate an optional timestamp range."""
    if start_at is not None and start_at < 0:
        raise ValidationError(f"{start_name} cannot be negative")
    if end_at is not None and end_at < 0:
        raise ValidationError(f"{end_name} cannot be negative")
    if start_at is not None and end_at is not None and start_at >= end_at:
        raise ValidationError(f"{start_name} must be earlier than {end_name}")


def sort_results(
    items: list,
    *,
    sort_by: str,
    sort_order: str,
    value_fn: Callable[[object, str], object],
) -> list:
    """Sort results with deterministic null handling."""
    descending = sort_order == "desc"
    return sorted(
        items,
        key=lambda item: _sort_key(item, sort_by, descending=descending, value_fn=value_fn),
        reverse=descending,
    )


def empty_sort_value(sort_by: str) -> object:
    """Return the default sort value for None fields."""
    if sort_by == "title":
        return ""
    return 0


def _sort_key(
    item: object,
    sort_by: str,
    *,
    descending: bool,
    value_fn: Callable[[object, str], object],
) -> tuple[bool, Any]:
    value = value_fn(item, sort_by)
    if isinstance(value, str):
        value = value.casefold()
    if descending:
        return (value is not None, value if value is not None else empty_sort_value(sort_by))
    return (value is None, value if value is not None else empty_sort_value(sort_by))
