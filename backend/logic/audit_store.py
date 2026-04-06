"""
JSON-file-backed audit store.

Persists intents, orders, withdrawals, and risk events to a JSON file
so audit data survives restarts.
"""

import json
import os
import time
import threading
from typing import Any, Dict, List

from backend.config.runtime import get_runtime_config

_lock = threading.Lock()


def _store_path() -> str:
    return os.environ.get(
        "AUDIT_STORE_PATH",
        get_runtime_config().persistence.audit_store_path,
    )


def _ensure_dir():
    dirpath = os.path.dirname(_store_path())
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)


def _load() -> Dict[str, List[Any]]:
    _ensure_dir()
    store_path = _store_path()
    if not os.path.exists(store_path):
        return {"intents": [], "orders": [], "withdrawals": [], "risk_events": []}
    try:
        with open(store_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"intents": [], "orders": [], "withdrawals": [], "risk_events": []}


def _save(data: Dict[str, List[Any]]):
    _ensure_dir()
    with open(_store_path(), "w") as f:
        json.dump(data, f, indent=2, default=str)


def append_intent(intent_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["intents"].append(intent_data)
        _save(data)


def append_order(order_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["orders"].append(order_data)
        _save(data)


def append_withdrawal(withdrawal_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["withdrawals"].append(withdrawal_data)
        _save(data)


def append_risk_event(event_data: Dict[str, Any]):
    with _lock:
        data = _load()
        data["risk_events"].append({
            **event_data,
            "timestamp": time.time(),
        })
        _save(data)


def get_audit() -> Dict[str, List[Any]]:
    with _lock:
        return _load()


def clear_audit():
    with _lock:
        _save({"intents": [], "orders": [], "withdrawals": [], "risk_events": []})
