"""Shared helpers for server route handlers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from exceptions import AMToDoError


def target_result(
    target: int,
    operation: Callable[[int], Any],
    to_dict: Callable[..., dict[str, object]],
    **dict_kwargs: object,
) -> dict[str, object]:
    """Execute *operation* on *target* and serialize the result.

    Returns a standard ``{"target": ..., "ok": True, ...}`` payload on success
    or ``{"target": ..., "ok": False, "error": ...}`` on domain errors.
    """
    try:
        entity = operation(target)
    except AMToDoError as exc:
        return {
            "target": target,
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    return {"target": target, "ok": True, **to_dict(entity, **dict_kwargs)}
