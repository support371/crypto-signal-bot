from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class EventLogStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS event_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS ix_event_log_kind_time ON event_log(kind, created_at)")

    def append(self, kind: str, payload: dict[str, Any] | None = None, created_at: int | None = None) -> int:
        self.initialize()
        timestamp = created_at or int(time.time())
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO event_log (kind, created_at, payload_json) VALUES (?, ?, ?)",
                (kind, timestamp, json.dumps(payload or {}, sort_keys=True)),
            )
            return int(cursor.lastrowid)

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        self.initialize()
        safe_limit = max(1, min(int(limit), 1000))
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, kind, created_at, payload_json FROM event_log ORDER BY created_at DESC, id DESC LIMIT ?",
                (safe_limit,),
            ).fetchall()
        return [
            {
                "id": int(row["id"]),
                "kind": row["kind"],
                "created_at": int(row["created_at"]),
                "payload": json.loads(row["payload_json"] or "{}"),
            }
            for row in rows
        ]

    def count(self) -> int:
        self.initialize()
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM event_log").fetchone()[0])
