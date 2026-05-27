from __future__ import annotations

import os
import threading
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.db.event_log import EventLogStore

router = APIRouter(prefix="/event-log", tags=["event-log"])

_event_log_store_instance: Optional[EventLogStore] = None
_event_log_lock = threading.Lock()


def event_log_enabled() -> bool:
    return os.environ.get("EVENT_LOG_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def event_log_path() -> str:
    return os.environ.get("EVENT_LOG_PATH", "backend/data/event_log.db")


def get_store() -> EventLogStore:
    # Optimization: Memoize the EventLogStore instance to avoid redundant re-instantiation
    # and directory/schema checks on every request.
    global _event_log_store_instance
    if _event_log_store_instance is None:
        with _event_log_lock:
            if _event_log_store_instance is None:
                _event_log_store_instance = EventLogStore(event_log_path())
    return _event_log_store_instance


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
