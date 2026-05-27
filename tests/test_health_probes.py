import asyncio
import json
import os
import unittest
from typing import Any, Dict

# Mock the environment
os.environ["TRADING_MODE"] = "paper"
os.environ["NETWORK"] = "testnet"

# Add parent directory to path to find backend
import sys
sys.path.append(os.getcwd())

from backend.health_wrapper import app

class TestHealthProbes(unittest.IsolatedAsyncioTestCase):
    async def _call_app(self, method: str, path: str) -> Dict[str, Any]:
        results = {}

        async def send(message: Dict[str, Any]):
            if message["type"] == "http.response.start":
                results["status"] = message["status"]
                results["headers"] = dict(message["headers"])
            elif message["type"] == "http.response.body":
                results["body"] = message.get("body", b"")

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.0"},
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "server": ("127.0.0.1", 80),
            "client": ("127.0.0.1", 54321),
            "scheme": "http",
        }

        await app(scope, None, send)
        return results

    async def test_get_root(self):
        resp = await self._call_app("GET", "/")
        self.assertEqual(resp["status"], 200)
        body = json.loads(resp["body"].decode())
        self.assertEqual(body["name"], "Crypto Signal Bot API")
        self.assertEqual(body["version"], "2.2.0")
        self.assertEqual(body["status"], "online")
        self.assertEqual(body["health"], "/health")

    async def test_head_root(self):
        resp = await self._call_app("HEAD", "/")
        self.assertEqual(resp["status"], 200)
        self.assertEqual(resp["body"], b"")

    async def test_get_health(self):
        for path in ("/health", "/healthz", "/api/health"):
            with self.subTest(path=path):
                resp = await self._call_app("GET", path)
                self.assertEqual(resp["status"], 200)
                body = json.loads(resp["body"].decode())
                self.assertEqual(body["status"], "ok")
                self.assertEqual(body["service"], "crypto-signal-bot-backend")
                self.assertEqual(body["runtime"], "render")
                self.assertEqual(body["uptime_seconds"], 0)

    async def test_head_health(self):
        for path in ("/health", "/healthz", "/api/health"):
            with self.subTest(path=path):
                resp = await self._call_app("HEAD", path)
                self.assertEqual(resp["status"], 200)
                self.assertEqual(resp["body"], b"")

    async def test_get_ready(self):
        resp = await self._call_app("GET", "/ready")
        self.assertEqual(resp["status"], 200)
        body = json.loads(resp["body"].decode())
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "crypto-signal-bot-backend")
        # Generic payload check
        self.assertNotIn("backend_api_key_configured", body)
        self.assertNotIn("cors_origins_configured", body)

    async def test_head_ready(self):
        resp = await self._call_app("HEAD", "/ready")
        self.assertEqual(resp["status"], 200)
        self.assertEqual(resp["body"], b"")

    async def test_delegation(self):
        # Path not in intercept list should delegate to the main app
        resp = await self._call_app("GET", "/api/v1/waitlist")
        self.assertIn("status", resp)
        # Check that it's NOT our health interceptor payload
        if resp["status"] == 200:
            body = json.loads(resp["body"].decode())
            self.assertNotIn("service", body)

if __name__ == "__main__":
    unittest.main()
