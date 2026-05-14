"""Pydantic request models for FastAPI endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TodoCreateRequest(BaseModel):
    title: str
    planned_at: int | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int = Field(default=0, ge=0)
    tag: str | None = None


class TodoUpdateRequest(BaseModel):
    title: str | None = None
    planned_at: int | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int | None = Field(default=None, ge=0)
    tag: str | None = None


class ScheduleCreateRequest(BaseModel):
    title: str
    start_at: int
    end_at: int
    description: str | None = None
    location: str | None = None
    category: str | None = None


class ScheduleUpdateRequest(BaseModel):
    title: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    description: str | None = None
    location: str | None = None
    category: str | None = None


class TargetsRequest(BaseModel):
    targets: list[int]


class UserCreateRequest(BaseModel):
    name: str


class UserUpdateRequest(BaseModel):
    name: str | None = None
