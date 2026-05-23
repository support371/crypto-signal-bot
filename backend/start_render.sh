#!/usr/bin/env bash
set -euo pipefail
PORT_VALUE="${PORT:-10000}"
exec python -m uvicorn backend.render_entrypoint:app --host 0.0.0.0 --port "${PORT_VALUE}"
