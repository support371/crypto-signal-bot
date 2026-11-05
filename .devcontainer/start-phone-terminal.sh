#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GEM_REMOTE_API_KEY:-}" ]]; then
  echo "GEM_REMOTE_API_KEY is not available in this Codespace; phone terminal was not started." >&2
  exit 1
fi

if ! command -v ttyd >/dev/null 2>&1; then
  echo "ttyd is not installed. Rebuild the existing Codespace container to run postCreateCommand." >&2
  exit 1
fi

PID_FILE="/tmp/gem-phone-terminal.pid"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  exit 0
fi

nohup ttyd --credential "gem:${GEM_REMOTE_API_KEY}" --writable --port 7681 bash -l \
  >/tmp/gem-phone-terminal.log 2>&1 &
echo "$!" > "$PID_FILE"
