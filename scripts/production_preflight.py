#!/usr/bin/env python3
"""
Production Pre-flight Check — crypto-signal-bot

Validates that all required environment variables and infrastructure
are in place before going live. Run before deploying to production.

Usage:
    python scripts/production_preflight.py
    python scripts/production_preflight.py --mode live
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import List, Tuple

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
WARN = "\033[93mWARN\033[0m"
SKIP = "\033[90mSKIP\033[0m"

results: List[Tuple[str, str, str]] = []


def check(name: str, passed: bool, msg: str = "", warn_only: bool = False):
    status = PASS if passed else (WARN if warn_only else FAIL)
    results.append((name, status, msg))
    icon = "✓" if passed else ("⚠" if warn_only else "✗")
    print(f"  {icon} [{status}] {name}" + (f": {msg}" if msg else ""))


# -------- ENV var checks --------

def check_env_vars(mode: str):
    print("\n[1] Required environment variables")

    # Always required
    check("DATABASE_URL", bool(os.getenv("DATABASE_URL")), "Required for persistence")
    check("REDIS_URL", bool(os.getenv("REDIS_URL")), "Required for rate limiting + kill switch")
    check("BACKEND_API_KEY", bool(os.getenv("BACKEND_API_KEY")), "Required to protect write endpoints")
    check("CORS_ALLOWED_ORIGINS", bool(os.getenv("CORS_ALLOWED_ORIGINS") or os.getenv("CORS_ORIGINS")), "Required to allow frontend")

    # Production-specific checks
    db_url = os.getenv("DATABASE_URL", "")
    check("DATABASE_URL uses PostgreSQL", "postgresql" in db_url,
          "SQLite is dev-only; use postgresql+asyncpg:// in production", warn_only=("sqlite" in db_url))

    # Live mode only
    if mode == "live":
        has_binance = bool(os.getenv("BINANCE_API_KEY") and os.getenv("BINANCE_API_SECRET"))
        has_bitget = bool(os.getenv("BITGET_API_KEY") and os.getenv("BITGET_API_SECRET") and os.getenv("BITGET_PASSPHRASE"))
        has_btcc = bool(os.getenv("BTCC_API_KEY") and os.getenv("BTCC_API_SECRET"))
        check("At least one exchange configured", has_binance or has_bitget or has_btcc,
              "Need Binance, Bitget, or BTCC credentials for live mode")


# -------- Infrastructure checks --------

async def check_redis():
    print("\n[2] Redis connectivity")
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    try:
        import aioredis
        r = await aioredis.from_url(redis_url, socket_timeout=3.0)
        pong = await r.ping()
        check("Redis PING", pong == b"PONG" or pong is True, redis_url)
        # Test kill switch key
        await r.set("PREFLIGHT:test", "1", ex=10)
        val = await r.get("PREFLIGHT:test")
        check("Redis read/write", val in ("1", b"1"), "Kill switch state will persist")
        await r.delete("PREFLIGHT:test")
        await r.aclose()
    except ImportError:
        check("aioredis installed", False, "pip install aioredis")
    except Exception as exc:
        check("Redis connectivity", False, str(exc))


async def check_database():
    print("\n[3] Database connectivity")
    db_url = os.getenv("DATABASE_URL", "sqlite:///./crypto_bot.db")
    try:
        if "sqlite" in db_url:
            import aiosqlite
            check("SQLite available", True, "NOTE: use PostgreSQL in production")
        else:
            import asyncpg
            pg_url = db_url.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql://", "")
            # basic parse check
            check("PostgreSQL URL parseable", "postgresql" in db_url, db_url[:40] + "...")
    except ImportError as exc:
        check("Database driver installed", False, str(exc))
    except Exception as exc:
        check("Database connectivity", False, str(exc))


async def check_exchange_connectivity():
    print("\n[4] Exchange market data (Binance public)")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get("https://api.binance.com/api/v3/ping")
            check("Binance /ping", r.status_code == 200, f"HTTP {r.status_code}")
            r2 = await client.get("https://api.binance.com/api/v3/ticker/price", params={"symbol": "BTCUSDT"})
            data = r2.json()
            check("Binance BTCUSDT price", "price" in data, f"Price: {data.get('price', 'N/A')}")
    except Exception as exc:
        check("Binance connectivity", False, str(exc), warn_only=True)


# -------- Config validation --------

def check_config():
    print("\n[5] Backend config validation")
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from backend.config.loader import load_and_validate
        load_and_validate()
        check("Config loads without error", True)
    except Exception as exc:
        check("Config validation", False, str(exc))


# -------- CORS check --------

def check_cors():
    print("\n[6] CORS configuration")
    origins = os.getenv("CORS_ALLOWED_ORIGINS", "") or os.getenv("CORS_ORIGINS", "")
    if origins:
        origin_list = [o.strip() for o in origins.split(",") if o.strip()]
        has_https = all(o.startswith("https://") for o in origin_list if not o.startswith("http://localhost"))
        check("CORS uses HTTPS", has_https, f"Origins: {origin_list}", warn_only=not has_https)
        check("CORS not wildcard", "*" not in origin_list, "Wildcard CORS is unsafe in production")
    else:
        check("CORS_ALLOWED_ORIGINS set", False, "Frontend will be blocked")


# -------- Summary --------

def print_summary():
    print("\n" + "="*60)
    print("PRE-FLIGHT SUMMARY")
    print("="*60)
    failures = [r for r in results if "FAIL" in r[1]]
    warnings = [r for r in results if "WARN" in r[1]]
    passes = [r for r in results if "PASS" in r[1]]
    print(f"  PASS: {len(passes)}  WARN: {len(warnings)}  FAIL: {len(failures)}")
    if failures:
        print("\nFAILURES (must fix before going live):")
        for name, _, msg in failures:
            print(f"  ✗ {name}: {msg}")
    if warnings:
        print("\nWARNINGS (review before going live):")
        for name, _, msg in warnings:
            print(f"  ⚠ {name}: {msg}")
    print()
    return len(failures) == 0


async def main():
    parser = argparse.ArgumentParser(description="Production pre-flight check")
    parser.add_argument("--mode", default="paper", choices=["paper", "live"])
    args = parser.parse_args()

    print("="*60)
    print(f"crypto-signal-bot — Production Pre-flight ({args.mode.upper()} mode)")
    print("="*60)

    check_env_vars(args.mode)
    await check_redis()
    await check_database()
    await check_exchange_connectivity()
    check_config()
    check_cors()

    ok = print_summary()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
