from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.db.event_log import EventLogStore

router = APIRouter(prefix="/event-log", tags=["event-log"])


def event_log_enabled() -> bool:
    return os.environ.get("EVENT_LOG_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def event_log_path() -> str:
    return os.environ.get("EVENT_LOG_PATH", "backend/data/event_log.db")


def get_store() -> EventLogStore:
    return EventLogStore(event_log_path())


@router.get("/status")
def get_event_log_status() -> dict[str, Any]:
    enabled = event_log_enabled()
    path = event_log_path()
    count = None
    ok = True
    error = None

    if enabled:
        try:
            count = get_store().count()
        except Exception as exc:
            ok = False
            error = str(exc)

    return {
        "enabled": enabled,
        "ok": ok,
        "path": path,
        "count": count,
        "error": error,
    }


@router.get("")
def list_event_log(limit: int = Query(100, ge=1, le=1000)) -> dict[str, Any]:
    if not event_log_enabled():
        raise HTTPException(status_code=404, detail="Event log is disabled")
    return {
        "enabled": True,
        "events": get_store().recent(limit=limit),
    }
