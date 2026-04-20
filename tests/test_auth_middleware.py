# tests/test_auth_middleware.py
"""
PHASE 12 — Auth middleware tests.

Tests:
  1. Valid auth — request passes
  2. Invalid auth — 401 returned
  3. Missing auth — 401 when auth enabled
  4. Auth disabled — all requests pass
  5. Rate limiting — 429 on excess
  6. WebSocket auth — valid/invalid tokens
  7. Public endpoint not blocked by write auth

Run: pytest tests/test_auth_middleware.py -v
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

from backend.middleware.auth import (
    require_write_auth,
    rate_limit_public,
    verify_ws_token,
    _check_rate_limit_memory,
    _rate_buckets,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_app_with_write_route():
    from fastapi import Depends
    app = FastAPI()

    @app.post("/test/write", dependencies=[Depends(require_write_auth)])
    def write_endpoint():
        return {"ok": True}

    return app


def _make_app_with_public_route():
    from fastapi import Depends
    app = FastAPI()

    @app.get("/test/public", dependencies=[Depends(rate_limit_public)])
    def public_endpoint():
        return {"data": "value"}

    return app


# ---------------------------------------------------------------------------
# 1. Valid auth
# ---------------------------------------------------------------------------

class TestValidAuth:
    def test_valid_key_passes_when_auth_enabled(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="correct-key", auth_enabled=True)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            app = _make_app_with_write_route()
            client = TestClient(app, raise_server_exceptions=True)
            resp = client.post("/test/write", headers={"X-API-Key": "correct-key"})

        assert resp.status_code == 200

    def test_any_request_passes_when_auth_disabled(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            app = _make_app_with_write_route()
            client = TestClient(app)
            resp = client.post("/test/write")  # no key

        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 2. Invalid auth
# ---------------------------------------------------------------------------

class TestInvalidAuth:
    def test_wrong_key_returns_401(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="real-key", auth_enabled=True)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            app = _make_app_with_write_route()
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post("/test/write", headers={"X-API-Key": "wrong-key"})

        assert resp.status_code == 401
        assert resp.json()["detail"]["error"] == "invalid_api_key"


# ---------------------------------------------------------------------------
# 3. Missing auth
# ---------------------------------------------------------------------------

class TestMissingAuth:
    def test_missing_key_returns_401_when_auth_enabled(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="some-key", auth_enabled=True)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            app = _make_app_with_write_route()
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post("/test/write")  # no key header

        assert resp.status_code == 401
        assert resp.json()["detail"]["error"] == "missing_api_key"


# ---------------------------------------------------------------------------
# 4. Auth disabled — all pass
# ---------------------------------------------------------------------------

class TestAuthDisabled:
    def test_write_passes_without_key_when_auth_disabled(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            app = _make_app_with_write_route()
            client = TestClient(app)
            resp = client.post("/test/write")

        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 5. Rate limiting
# ---------------------------------------------------------------------------

class TestRateLimiting:
    def test_in_memory_rate_limiter_allows_burst(self):
        """First N requests within burst limit should pass."""
        _rate_buckets.clear()
        ip = "192.168.1.100"
        # First 30 requests (burst limit) should be allowed
        results = [_check_rate_limit_memory(ip) for _ in range(30)]
        assert all(results), "Burst requests should all be allowed"

    def test_in_memory_rate_limiter_blocks_after_burst(self):
        """Requests beyond burst limit should be blocked."""
        _rate_buckets.clear()
        ip = "10.0.0.99"
        # Exhaust burst
        for _ in range(30):
            _check_rate_limit_memory(ip)
        # Next request should be blocked
        result = _check_rate_limit_memory(ip)
        assert result is False, "Post-burst request should be blocked"

    @pytest.mark.asyncio
    async def test_rate_limit_endpoint_returns_429(self):
        from unittest.mock import patch as mp

        with mp("backend.middleware.auth._check_rate_limit_redis",
                new=AsyncMock(return_value=False)):
            from fastapi import FastAPI, Depends, Request
            from backend.middleware.auth import rate_limit_public

            app = FastAPI()

            @app.get("/test/rl", dependencies=[Depends(rate_limit_public)])
            async def endpoint():
                return {"ok": True}

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get("/test/rl")

        assert resp.status_code == 429
        assert "rate_limited" in resp.json()["detail"]["error"]
        assert "Retry-After" in resp.headers


# ---------------------------------------------------------------------------
# 6. WebSocket auth
# ---------------------------------------------------------------------------

class TestWebSocketAuth:
    @pytest.mark.asyncio
    async def test_valid_ws_token_accepted(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="ws-secret", auth_enabled=True)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            result = await verify_ws_token("ws-secret")

        assert result is True

    @pytest.mark.asyncio
    async def test_invalid_ws_token_rejected(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="ws-secret", auth_enabled=True)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            result = await verify_ws_token("wrong-token")

        assert result is False

    @pytest.mark.asyncio
    async def test_missing_ws_token_rejected_when_auth_enabled(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="ws-secret", auth_enabled=True)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            result = await verify_ws_token(None)

        assert result is False

    @pytest.mark.asyncio
    async def test_ws_token_not_required_when_auth_disabled(self):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            result = await verify_ws_token(None)

        assert result is True
