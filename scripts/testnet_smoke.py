#!/usr/bin/env python3
"""
Authenticated live/testnet certification harness.

Verifies exchange connectivity, ticker access, balances, order placement, order
status, cancellation, reconciliation, and a liquidation path where supported.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

from backend.logic.exchange_adapter import build_adapter, get_required_credential_envs
from backend.logic.paper_trading import PaperPortfolio, _synthetic_price

load_dotenv("backend/env/.env")
load_dotenv()

SYMBOL = "BTC/USDT"
MIN_QTY_BY_EXCHANGE = {
    "binance": 0.0001,
    "bitget": 0.0001,
    "btcc": 0.0001,
}


def section(title: str) -> None:
    print(f"\n{'─' * 50}")
    print(f"  {title}")
    print(f"{'─' * 50}")


def fail(message: str, *, exit_code: int = 1) -> None:
    print(f"[FAIL] {message}")
    sys.exit(exit_code)


def warn(message: str) -> None:
    print(f"[WARN] {message}")


def exchange_choice() -> str:
    return os.getenv("EXCHANGE", "binance").strip().lower()


def check_env(exchange: str) -> list[str]:
    trading_mode = os.getenv("TRADING_MODE", "paper")
    network = os.getenv("NETWORK", "testnet")
    errors = []
    if trading_mode != "live":
        errors.append(f"TRADING_MODE={trading_mode!r} — must be 'live' for this script")
    if network != "testnet":
        errors.append(f"NETWORK={network!r} — must be 'testnet' (never run smoke against mainnet)")
    for env_name in get_required_credential_envs(exchange):
        if not os.getenv(env_name, ""):
            errors.append(f"{env_name} is not set")
    if exchange == "btcc":
        errors.append(
            "BTCC authenticated demo/testnet trading is not supported by the current adapter; "
            "use this harness for Binance or Bitget and treat BTCC authenticated certification as blocked."
        )
    return errors


def build_live_adapter(exchange: str):
    portfolio = PaperPortfolio()
    portfolio.balances = {"USDT": 10000.0}
    adapter = build_adapter(
        "live",
        "testnet",
        portfolio,
        _synthetic_price,
        exchange=exchange,
    )
    if adapter.mode == "paper":
        fail(
            f"Live adapter for {exchange} fell back to paper. "
            "Check credentials, ccxt install, or unsupported demo/testnet path."
        )
    return adapter


def run_smoke(exchange: str, dry_run: bool) -> None:
    qty = MIN_QTY_BY_EXCHANGE.get(exchange, 0.0001)

    section("1 / Connectivity and adapter selection")
    adapter = build_live_adapter(exchange)
    print(f"  [OK] adapter mode: {adapter.mode}")
    print(f"  [OK] exchange: {adapter.exchange}")

    section("2 / Ticker and balance")
    last_price = adapter.get_price(SYMBOL)
    print(f"  [OK] {SYMBOL} last price: {last_price:.8f}")
    usdt_free = adapter.get_balance("USDT")
    print(f"  [OK] USDT free balance: {usdt_free:.8f}")

    section("3 / Reconciliation")
    reconciliation = adapter.reconcile()
    print("  [OK] reconciliation snapshot captured")
    print(f"       open_orders={len(reconciliation.get('open_orders', []))}")

    if dry_run:
        section("4 / Order placement, status, cancellation, liquidation — SKIPPED (--dry-run)")
        print("  [SKIP] Dry-run mode stops after connectivity, ticker, balance, and reconciliation.")
        return

    if usdt_free <= (last_price * qty):
        warn("Insufficient quote balance for market buy test; placement/liquidation checks skipped")
        return

    section("4 / Market buy order placement")
    buy_order = adapter.place_order(
        symbol=SYMBOL,
        side="BUY",
        order_type="MARKET",
        quantity=qty,
    )
    print(f"  [OK] buy order placed: id={buy_order.get('id')} status={buy_order.get('status')}")

    section("5 / Order status")
    buy_status = adapter.get_order_status(buy_order["id"], SYMBOL)
    print(f"  [OK] fetched order status: {buy_status.get('status')}")

    section("6 / Cancel path via deep limit order")
    limit_price = max(last_price * 0.5, 1.0)
    limit_order = adapter.place_order(
        symbol=SYMBOL,
        side="BUY",
        order_type="LIMIT",
        quantity=qty,
        price=limit_price,
    )
    print(f"  [OK] limit order submitted: id={limit_order.get('id')} status={limit_order.get('status')}")
    try:
        cancel_result = adapter.cancel_order(limit_order["id"], SYMBOL)
        print(f"  [OK] cancel result: {cancel_result.get('status')}")
    except Exception as exc:
        warn(f"Cancellation check failed: {exc}")

    section("7 / Reconciliation after order flow")
    reconciliation_after = adapter.reconcile()
    print("  [OK] post-order reconciliation captured")
    print(f"       open_orders={len(reconciliation_after.get('open_orders', []))}")

    section("8 / Kill-switch liquidation path")
    try:
        liquidation = adapter.liquidate_all_positions()
        print("  [OK] liquidation path executed")
        print(f"       liquidated_positions={liquidation.get('liquidated_positions')}")
    except Exception as exc:
        warn(f"Liquidation path failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Exchange testnet/demo smoke test")
    parser.add_argument(
        "--exchange",
        choices=("binance", "bitget", "btcc"),
        default=exchange_choice(),
        help="Exchange to certify.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip order placement and liquidation checks.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip pre-flight checks (not recommended).",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("  Crypto Signal Bot — Live/Testnet Smoke Test")
    print("=" * 50)
    print(f"  Exchange: {args.exchange}")

    if not args.force:
        errors = check_env(args.exchange)
        if errors:
            print("\n[PRE-FLIGHT FAILED] Fix these before running:\n")
            for error in errors:
                print(f"  ✗  {error}")
            print("\nUse --force to bypass these checks (not recommended).\n")
            sys.exit(1)
        print("  [OK] Pre-flight checks passed")

    run_smoke(args.exchange, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
