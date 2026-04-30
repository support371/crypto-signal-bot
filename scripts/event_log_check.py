from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.db.event_log import EventLogStore


def run_check(path: Path) -> int:
    store = EventLogStore(path)
    before = store.count()
    row_id = store.append("event_log.check", {"ok": True, "before": before})
    latest = store.recent(limit=1)
    after = store.count()

    result = {
        "path": str(path),
        "before": before,
        "after": after,
        "row_id": row_id,
        "latest": latest[0] if latest else None,
    }
    print(json.dumps(result, indent=2, sort_keys=True))

    return 0 if after == before + 1 and latest and latest[0]["id"] == row_id else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the local event-log store.")
    parser.add_argument("--path", default="backend/data/event_log_check.db")
    args = parser.parse_args()
    return run_check(Path(args.path))


if __name__ == "__main__":
    raise SystemExit(main())
