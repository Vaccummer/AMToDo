"""Domain-level exceptions used across application boundaries."""

from __future__ import annotations


class AMToDoError(Exception):
    """Base exception for expected application errors."""


class ValidationError(AMToDoError):
    """Raised when input cannot be accepted by the application rules."""


class ConflictError(AMToDoError):
    """Raised when a schedule item conflicts with an existing time window."""


class NotFoundError(AMToDoError):
    """Raised when a requested entity cannot be found."""
