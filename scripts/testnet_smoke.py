#!/usr/bin/env python3
"""
Testnet smoke test — manual validation script.

Verifies that the CCXT Binance testnet adapter can:
  1. Connect and authenticate
  2. Fetch account balance
  3. Fetch current BTC/USDT price
  4. Place a minimal market buy order
  5. Fetch updated balance and confirm change

Prerequisites:
  pip install ccxt python-dotenv
  BINANCE_API_KEY and BINANCE_API_SECRET set (testnet.binance.vision keys)
  TRADING_MODE=live  NETWORK=testnet  (or pass --force to skip env check)

Run from the repo root:
  python scripts/testnet_smoke.py
  python scripts/testnet_smoke.py --dry-run   # skip order placement
"""

import argparse
import os
import sys
import time

# Allow running from repo root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv("backend/env/.env")
load_dotenv()

SYMBOL = "BTC/USDT"
MIN_ORDER_QTY = 0.0001  # smallest viable BTC testnet order


def check_env():
    trading_mode = os.getenv("TRADING_MODE", "paper")
    network = os.getenv("NETWORK", "testnet")
    key = os.getenv("BINANCE_API_KEY", "")
    secret = os.getenv("BINANCE_API_SECRET", "")

    errors = []
    if trading_mode != "live":
        errors.append(f"TRADING_MODE={trading_mode!r} — must be 'live' for this script")
    if network != "testnet":
        errors.append(f"NETWORK={network!r} — must be 'testnet' (never run smoke against mainnet)")
    if not key:
        errors.append("BINANCE_API_KEY is not set")
    if not secret:
        errors.append("BINANCE_API_SECRET is not set")
    return errors


def build_ccxt_exchange():
    try:
        import ccxt
    except ImportError:
        print("[FAIL] ccxt is not installed. Run: pip install ccxt")
        sys.exit(1)

    key = os.getenv("BINANCE_API_KEY")
    secret = os.getenv("BINANCE_API_SECRET")

    exchange = ccxt.binance({
        "apiKey": key,
        "secret": secret,
        "enableRateLimit": True,
        "options": {"defaultType": "spot"},
    })
    exchange.set_sandbox_mode(True)
    return exchange


def section(title):
    print(f"\n{'─' * 50}")
    print(f"  {title}")
    print(f"{'─' * 50}")


def run_smoke(dry_run: bool):
    section("1 / Connect and load markets")
    exchange = build_ccxt_exchange()
    try:
        markets = exchange.load_markets()
        print(f"  [OK] Connected — {len(markets)} markets loaded")
    except Exception as e:
        print(f"  [FAIL] load_markets: {e}")
        sys.exit(1)

    section("2 / Fetch account balance (USDT)")
    try:
        balance = exchange.fetch_balance()
        usdt_free = balance.get("free", {}).get("USDT", 0.0)
        btc_free = balance.get("free", {}).get("BTC", 0.0)
        print(f"  [OK] USDT free: {usdt_free:.4f}")
        print(f"  [OK] BTC  free: {btc_free:.8f}")
    except Exception as e:
        print(f"  [FAIL] fetch_balance: {e}")
        sys.exit(1)

    section("3 / Fetch BTC/USDT price")
    try:
        ticker = exchange.fetch_ticker(SYMBOL)
        price = ticker["last"]
        print(f"  [OK] {SYMBOL} last price: {price:.2f} USDT")
    except Exception as e:
        print(f"  [FAIL] fetch_ticker: {e}")
        sys.exit(1)

    if dry_run:
        section("4 / Order placement — SKIPPED (--dry-run)")
        print("  [SKIP] Pass without --dry-run to place a real testnet order")
    else:
        section("4 / Place minimal market BUY order")
        cost = price * MIN_ORDER_QTY
        if usdt_free < cost * 1.01:
            print(f"  [WARN] Insufficient USDT ({usdt_free:.2f}) for {MIN_ORDER_QTY} BTC @ {price:.2f}")
            print("         Fund your testnet account at https://testnet.binance.vision")
            print("  [SKIP] Order placement skipped due to insufficient balance")
        else:
            try:
                order = exchange.create_market_buy_order(SYMBOL, MIN_ORDER_QTY)
                fill = order.get("average") or order.get("price") or price
                filled_qty = order.get("filled", MIN_ORDER_QTY)
                print(f"  [OK] Order placed: id={order['id']}")
                print(f"       side=BUY  qty={filled_qty:.8f} BTC  fill={fill:.2f} USDT")
                print(f"       status={order.get('status', 'unknown')}")

                section("5 / Verify updated balance")
                time.sleep(1)
                balance2 = exchange.fetch_balance()
                usdt2 = balance2.get("free", {}).get("USDT", 0.0)
                btc2 = balance2.get("free", {}).get("BTC", 0.0)
                print(f"  [OK] USDT free: {usdt2:.4f} (was {usdt_free:.4f})")
                print(f"  [OK] BTC  free: {btc2:.8f} (was {btc_free:.8f})")
                if btc2 > btc_free:
                    print("  [PASS] BTC balance increased — testnet order confirmed")
                else:
                    print("  [WARN] BTC balance unchanged — order may be pending")
            except Exception as e:
                print(f"  [FAIL] create_market_buy_order: {e}")
                sys.exit(1)

    section("Smoke test complete")
    print("  Testnet adapter is operational.\n")


def main():
    parser = argparse.ArgumentParser(description="Binance testnet smoke test")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Skip order placement — only test connection, balance, and price"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Skip env var pre-flight checks (not recommended)"
    )
    args = parser.parse_args()

    print("=" * 50)
    print("  Crypto Signal Bot — Testnet Smoke Test")
    print("=" * 50)

    if not args.force:
        errors = check_env()
        if errors:
            print("\n[PRE-FLIGHT FAILED] Fix these before running:\n")
            for e in errors:
                print(f"  ✗  {e}")
            print(
                "\nSet vars in backend/env/.env or export them, then re-run.\n"
                "Use --force to bypass these checks (not recommended).\n"
            )
            sys.exit(1)
        print("  [OK] Pre-flight checks passed")

    run_smoke(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
