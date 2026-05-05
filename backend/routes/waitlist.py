from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException


waitlist_router = APIRouter(prefix="/api/v1", tags=["waitlist"])

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_WAITLIST_LOCK = threading.Lock()


def _get_waitlist_path() -> Path:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "waitlist.json"


def _load_waitlist() -> Dict[str, Any]:
    path = _get_waitlist_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _persist_waitlist(data: Dict[str, Any]) -> None:
    path = _get_waitlist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_path.replace(path)


@waitlist_router.post("/waitlist")
def join_waitlist(payload: Dict[str, str]) -> dict:
    email = payload.get("email", "").strip().lower()
    if not email or not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    with _WAITLIST_LOCK:
        waitlist = _load_waitlist()
        if email in waitlist:
            raise HTTPException(status_code=400, detail="Email already on waitlist")

        waitlist[email] = {"timestamp": int(time.time())}
        _persist_waitlist(waitlist)

    return {"status": "success"}
