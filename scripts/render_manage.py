#!/usr/bin/env python3
"""
Small, dependency-free Render management helper for crypto-signal-bot.

This script uses the official Render REST API when RENDER_API_KEY is present.
It never prints secret values and it only allows a conservative set of env vars
that are needed for the current paper/demo deployment path. Live-trading envs
are intentionally not allowlisted here.

Examples:
  python scripts/render_manage.py health
  RENDER_API_KEY=... python scripts/render_manage.py list-services
  RENDER_API_KEY=... python scripts/render_manage.py find-service crypto-signal-bot-deqd
  RENDER_API_KEY=... python scripts/render_manage.py deploys srv_xxx
  RENDER_API_KEY=... python scripts/render_manage.py env-vars srv_xxx
  RENDER_API_KEY=... python scripts/render_manage.py set-env srv_xxx CORS_ALLOWED_ORIGINS https://crypto-signal-bot-indol.vercel.app --confirm
  RENDER_API_KEY=... python scripts/render_manage.py create-deploy srv_xxx --confirm
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional

API_BASE = "https://api.render.com/v1"
DEFAULT_HEALTH_URL = "https://crypto-signal-bot-deqd.onrender.com/health"

# Keep this intentionally narrow. Do not include LIVE_TRADING_ENABLED,
# CONFIRM_LIVE_TRADING, exchange credentials, or other live-money controls.
ENV_ALLOWLIST = {
    "TRADING_MODE",
    "CORS_ALLOWED_ORIGINS",
    "CORS_ORIGINS",  # legacy name used by earlier docs/configs
    "EVENT_LOG_ENABLED",
    "EVENT_LOG_PATH",
    "AUDIT_STORE_PATH",
    "EARNINGS_STORE_PATH",
    "BACKEND_API_KEY",
}

SECRET_KEYS = {"BACKEND_API_KEY"}


@dataclass
class ApiResponse:
    status: int
    data: Any


class RenderApiError(RuntimeError):
    pass


def require_api_key() -> str:
    token = os.getenv("RENDER_API_KEY")
    if not token:
        raise RenderApiError(
            "RENDER_API_KEY is not set. Create a Render API key in the Render dashboard "
            "and pass it through your shell environment. Never commit it."
        )
    return token


def request_json(method: str, path: str, body: Optional[Dict[str, Any]] = None) -> ApiResponse:
    token = require_api_key()
    url = path if path.startswith("https://") else f"{API_BASE}{path}"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url=url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            parsed = json.loads(raw) if raw else None
            return ApiResponse(status=resp.status, data=parsed)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else raw
        except json.JSONDecodeError:
            parsed = raw
        raise RenderApiError(f"Render API error {exc.code} for {method} {url}: {parsed}") from exc
    except urllib.error.URLError as exc:
        raise RenderApiError(f"Network error talking to Render API: {exc}") from exc


def print_json(data: Any) -> None:
    print(json.dumps(redact(data), indent=2, sort_keys=True))


def redact(value: Any) -> Any:
    """Redact likely secrets before printing responses."""
    if isinstance(value, dict):
        redacted: Dict[str, Any] = {}
        for key, val in value.items():
            upper = key.upper()
            if any(token in upper for token in ["SECRET", "TOKEN", "KEY", "PASSWORD"]):
                redacted[key] = "<redacted>" if val else val
            else:
                redacted[key] = redact(val)
        return redacted
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def command_health(args: argparse.Namespace) -> int:
    req = urllib.request.Request(args.url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            raw = resp.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            print_json({"status_code": resp.status, "url": args.url, "body": parsed})
            return 0 if 200 <= resp.status < 300 else 1
    except Exception as exc:  # noqa: BLE001 - CLI should surface full failure context
        print_json({"url": args.url, "error": str(exc)})
        return 1


def command_list_services(args: argparse.Namespace) -> int:
    params = urllib.parse.urlencode({"limit": args.limit})
    response = request_json("GET", f"/services?{params}")
    print_json(response.data)
    return 0


def iter_service_items(payload: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                yield item
    elif isinstance(payload, dict):
        # Render list endpoints commonly return a list, but tolerate wrappers.
        for key in ["services", "data", "items"]:
            items = payload.get(key)
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        yield item


def service_name(item: Dict[str, Any]) -> str:
    service = item.get("service", item)
    if isinstance(service, dict):
        return str(service.get("name", ""))
    return str(item.get("name", ""))


def service_id(item: Dict[str, Any]) -> str:
    service = item.get("service", item)
    if isinstance(service, dict):
        return str(service.get("id", ""))
    return str(item.get("id", ""))


def command_find_service(args: argparse.Namespace) -> int:
    params = urllib.parse.urlencode({"limit": args.limit})
    response = request_json("GET", f"/services?{params}")
    matches = []
    needle = args.name.lower()
    for item in iter_service_items(response.data):
        if needle in service_name(item).lower():
            matches.append(item)
    print_json(matches)
    return 0 if matches else 1


def command_get_service(args: argparse.Namespace) -> int:
    response = request_json("GET", f"/services/{urllib.parse.quote(args.service_id)}")
    print_json(response.data)
    return 0


def command_deploys(args: argparse.Namespace) -> int:
    params = urllib.parse.urlencode({"limit": args.limit})
    response = request_json("GET", f"/services/{urllib.parse.quote(args.service_id)}/deploys?{params}")
    print_json(response.data)
    return 0


def command_create_deploy(args: argparse.Namespace) -> int:
    if not args.confirm:
        raise RenderApiError("Refusing to create deploy without --confirm.")
    # Render supports creating deploys through the service deploys collection.
    body: Dict[str, Any] = {}
    if args.clear_cache:
        body["clearCache"] = "clear"
    response = request_json("POST", f"/services/{urllib.parse.quote(args.service_id)}/deploys", body)
    print_json(response.data)
    return 0


def command_env_vars(args: argparse.Namespace) -> int:
    response = request_json("GET", f"/services/{urllib.parse.quote(args.service_id)}/env-vars")
    print_json(response.data)
    return 0


def command_set_env(args: argparse.Namespace) -> int:
    key = args.key.strip()
    if key not in ENV_ALLOWLIST:
        allowed = ", ".join(sorted(ENV_ALLOWLIST))
        raise RenderApiError(
            f"Refusing to set non-allowlisted env var {key!r}. Allowed keys: {allowed}. "
            "This script intentionally does not manage live-trading or exchange credential env vars."
        )
    if not args.confirm:
        raise RenderApiError("Refusing to modify Render env vars without --confirm.")
    # Render's env-var API accepts a single env var resource update at this path.
    # If the API shape changes, the error message will include Render's response.
    path = f"/services/{urllib.parse.quote(args.service_id)}/env-vars/{urllib.parse.quote(key)}"
    body = {"value": args.value}
    response = request_json("PUT", path, body)
    display_value = "<redacted>" if key in SECRET_KEYS else args.value
    print_json({"updated": key, "value": display_value, "response": response.data})
    return 0


def command_diagnose(args: argparse.Namespace) -> int:
    failures = 0
    print("== Health ==")
    failures += command_health(argparse.Namespace(url=args.health_url, timeout=args.timeout))
    if os.getenv("RENDER_API_KEY"):
        print("\n== Matching services ==")
        try:
            command_find_service(argparse.Namespace(name=args.service_name, limit=args.limit))
        except RenderApiError as exc:
            print(f"Render API diagnostic failed: {exc}")
            failures += 1
    else:
        print("\nSkipping Render API service diagnostics because RENDER_API_KEY is not set.")
    return 1 if failures else 0


def command_mcp_config(args: argparse.Namespace) -> int:
    token_placeholder = "<YOUR_RENDER_API_KEY>"
    if args.tool == "cursor":
        print_json(
            {
                "mcpServers": {
                    "render": {
                        "url": "https://mcp.render.com/mcp",
                        "headers": {"Authorization": f"Bearer {token_placeholder}"},
                    }
                }
            }
        )
    elif args.tool == "codex":
        print(
            "# Add to your Codex MCP config, replacing the placeholder with a Render API key stored outside git.\n"
            "[mcp_servers.render]\n"
            'url = "https://mcp.render.com/mcp"\n'
            "[mcp_servers.render.headers]\n"
            f'Authorization = "Bearer {token_placeholder}"'
        )
    else:
        raise RenderApiError(f"Unsupported tool: {args.tool}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage and diagnose Render deployment for crypto-signal-bot.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("health", help="Check backend /health without needing a Render API key")
    p.add_argument("--url", default=DEFAULT_HEALTH_URL)
    p.add_argument("--timeout", type=int, default=20)
    p.set_defaults(func=command_health)

    p = sub.add_parser("list-services", help="List Render services")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=command_list_services)

    p = sub.add_parser("find-service", help="Find services by name substring")
    p.add_argument("name")
    p.add_argument("--limit", type=int, default=100)
    p.set_defaults(func=command_find_service)

    p = sub.add_parser("get-service", help="Get one Render service by id")
    p.add_argument("service_id")
    p.set_defaults(func=command_get_service)

    p = sub.add_parser("deploys", help="List recent deploys for a service")
    p.add_argument("service_id")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=command_deploys)

    p = sub.add_parser("create-deploy", help="Trigger a new Render deploy for a service")
    p.add_argument("service_id")
    p.add_argument("--clear-cache", action="store_true")
    p.add_argument("--confirm", action="store_true")
    p.set_defaults(func=command_create_deploy)

    p = sub.add_parser("env-vars", help="List env vars for a service, redacted")
    p.add_argument("service_id")
    p.set_defaults(func=command_env_vars)

    p = sub.add_parser("set-env", help="Set one allowlisted Render env var")
    p.add_argument("service_id")
    p.add_argument("key")
    p.add_argument("value")
    p.add_argument("--confirm", action="store_true")
    p.set_defaults(func=command_set_env)

    p = sub.add_parser("diagnose", help="Run health check and optional API diagnostics")
    p.add_argument("--health-url", default=DEFAULT_HEALTH_URL)
    p.add_argument("--service-name", default="crypto-signal-bot")
    p.add_argument("--timeout", type=int, default=20)
    p.add_argument("--limit", type=int, default=100)
    p.set_defaults(func=command_diagnose)

    p = sub.add_parser("mcp-config", help="Print safe placeholder MCP config for compatible tools")
    p.add_argument("--tool", choices=["cursor", "codex"], default="cursor")
    p.set_defaults(func=command_mcp_config)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except RenderApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
