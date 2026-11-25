"""Shared FastAPI dependencies for route modules.

Avoids circular imports by reading app-level config at call time
via sys.modules instead of a static import of backend.app.
"""

import sys
from typing import Optional

from fastapi import HTTPException, Security
from fastapi.security.api_key import APIKeyHeader

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_auth(api_key: Optional[str] = Security(_api_key_header)):
    app = sys.modules.get("backend.app")
    key = getattr(app, "BACKEND_API_KEY", "") if app else ""
    if not key:
        return
    if api_key != key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
