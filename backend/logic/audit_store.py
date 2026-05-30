"""
JSON-file-backed audit store.

Persists intents, orders, withdrawals, and risk events to a JSON file
so audit data survives restarts.

When EVENT_LOG_ENABLED=true, writes are also copied to the lightweight
SQLite event-log store. JSON remains the default source of truth.
"""

import json
import os
import time
import threading
from typing import Any, Dict, List, Optional

from backend.config.runtime import get_runtime_config
from backend.db.event_log import EventLogStore

_lock = threading.Lock()
_event_log_lock = threading.Lock()
_cache: Optional[Dict[str, List[Any]]] = None
_event_log_store_instance: Optional[EventLogStore] = None


def _store_path() -> str:
    return os.environ.get(
        "AUDIT_STORE_PATH",
        get_runtime_config().persistence.audit_store_path,
    )


def _event_log_enabled() -> bool:
    return os.environ.get("EVENT_LOG_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def _event_log_path() -> str:
    return os.environ.get("EVENT_LOG_PATH", "backend/data/event_log.db")


def _event_log_store() -> EventLogStore:
    global _event_log_store_instance
    if _event_log_store_instance is None:
        _event_log_store_instance = EventLogStore(_event_log_path())
    return _event_log_store_instance


def _copy_to_event_log(kind: str, payload: Dict[str, Any]) -> None:
    if not _event_log_enabled():
        return
    try:
        _event_log_store().append(kind, payload)
    except Exception:
        # Preserve existing JSON behavior even if the optional event log is unavailable.
        return


def _ensure_dir():
    dirpath = os.path.dirname(_store_path())
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)


def _load() -> Dict[str, List[Any]]:
    global _cache
    if _cache is not None:
        return _cache

    _ensure_dir()
    store_path = _store_path()
    if not os.path.exists(store_path):
        _cache = {"intents": [], "orders": [], "withdrawals": [], "risk_events": [], "traces": []}
        return _cache
    try:
        with open(store_path, "r") as f:
            _cache = json.load(f)
            if "traces" not in _cache:
                _cache["traces"] = []
            return _cache
    except (json.JSONDecodeError, IOError):
        _cache = {"intents": [], "orders": [], "withdrawals": [], "risk_events": [], "traces": []}
        return _cache


def _save(data: Dict[str, List[Any]]):
    global _cache
    _cache = data
    _ensure_dir()
    with open(_store_path(), "w") as f:
        # Optimization: removed indent=2 to reduce file size and write time.
        # This is a persistence file, not intended for frequent manual reading.
        json.dump(data, f, default=str)


def append_intent(intent_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["intents"].append(intent_data)
        _save(data)
        _copy_to_event_log("audit.intent", intent_data)


def append_order(order_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["orders"].append(order_data)
        _save(data)
        _copy_to_event_log("audit.order", order_data)


def append_withdrawal(withdrawal_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["withdrawals"].append(withdrawal_data)
        _save(data)
        _copy_to_event_log("audit.withdrawal", withdrawal_data)


def append_risk_event(event_data: Dict[str, Any]):
    with _lock:
        data = _load()
        event = {
            **event_data,
            "timestamp": time.time(),
        }
        data["risk_events"].append(event)
        _save(data)
        _copy_to_event_log("audit.risk_event", event)


def get_audit() -> Dict[str, List[Any]]:
    with _lock:
        return _load()


def append_trace(trace_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["traces"].append(trace_data)
        _save(data)
        _copy_to_event_log("audit.trace", trace_data)


def get_traces(symbol: Optional[str] = None, status: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    with _lock:
        # Copy the list while holding the lock so subsequent appends cannot
        # mutate the slice we hand back to the caller.
        traces = list(_load().get("traces", []))
    if symbol:
        traces = [t for t in traces if t.get("symbol", "").upper() == symbol.upper()]
    if status:
        traces = [t for t in traces if t.get("execution", {}).get("status") == status]
    return traces[-limit:]


def get_trace_by_intent_id(intent_id: str) -> Optional[Dict[str, Any]]:
    """Return the full decision trace for a given intent id, or None if missing.

    Searches every persisted trace (not just the most recent window) so older
    traces remain retrievable via GET /trace/{intent_id}.
    """
    with _lock:
        traces = list(_load().get("traces", []))
    for trace in traces:
        if trace.get("intent_id") == intent_id:
            return trace
    return None


def clear_audit():
    with _lock:
        _save({"intents": [], "orders": [], "withdrawals": [], "risk_events": [], "traces": []})
