"""Tests for the fail-closed live execution adapter guard."""

from __future__ import annotations

import pytest

from backend.logic.live_execution_guard import (
    GuardedExchangeAdapter,
    LiveExecutionBlocked,
    build_live_readiness_report,
)


class FakeAdapter:
    def __init__(self, mode: str = "paper", price: float = 100.0):
        self._mode = mode
        self._price = price
        self.exchange = "fake"
        self.orders: list[dict] = []

    @property
    def mode(self) -> str:
        return self._mode

    def place_order(self, **payload) -> dict:
        self.orders.append(payload)
        return {"id": "order-1", "status": "FILLED", **payload}

    def get_price(self, symbol: str) -> float:
        return self._price

    def get_balance(self, asset: str = "USDT") -> float:
        return 1000.0

    def get_order_status(self, order_id: str, symbol: str) -> dict:
        return {"id": order_id, "symbol": symbol, "status": "OPEN"}

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        return {"id": order_id, "symbol": symbol, "status": "CANCELLED"}

    def reconcile(self) -> dict:
        return {"status": "ok"}

    def liquidate_all_positions(self) -> dict:
        return {"status": "closed"}


def _live_env(**overrides: str) -> dict[str, str]:
    env = {
        "LIVE_EXECUTION_ENABLED": "true",
        "LIVE_OWNER_APPROVED": "true",
        "LIVE_APPROVAL_ID": "approval-123",
        "LIVE_TESTNET_ENABLED": "true",
        "LIVE_MAINNET_ENABLED": "false",
        "ALLOW_MAINNET": "false",
        "LIVE_ALLOWED_SYMBOLS": "BTCUSDT,ETHUSDT",
        "LIVE_MAX_ORDER_NOTIONAL_USDT": "100",
    }
    env.update(overrides)
    return env


def _guard(
    adapter: FakeAdapter,
    *,
    trading_mode: str = "live",
    network: str = "testnet",
    guardian_halted: bool = False,
    env: dict[str, str] | None = None,
    api_key: bool = True,
) -> GuardedExchangeAdapter:
    return GuardedExchangeAdapter(
        adapter,
        trading_mode=trading_mode,
        network=network,
        guardian_halted=lambda: guardian_halted,
        backend_api_key_configured=lambda: api_key,
        env=env if env is not None else _live_env(),
    )


def test_paper_mode_preserves_existing_execution_without_live_flags():
    adapter = FakeAdapter(mode="paper")
    guard = _guard(adapter, trading_mode="paper", env={})

    result = guard.place_order(
        symbol="BTCUSDT",
        side="BUY",
        order_type="MARKET",
        quantity=0.01,
    )

    assert result["status"] == "FILLED"
    assert len(adapter.orders) == 1


def test_live_mode_is_blocked_by_default():
    adapter = FakeAdapter(mode="testnet")
    guard = _guard(adapter, env={})

    with pytest.raises(LiveExecutionBlocked) as exc:
        guard.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="MARKET",
            quantity=0.01,
        )

    assert "live_execution_disabled" in exc.value.reasons
    assert adapter.orders == []


def test_live_mode_with_paper_fallback_cannot_create_false_live_fill():
    adapter = FakeAdapter(mode="paper")
    guard = _guard(adapter)

    with pytest.raises(LiveExecutionBlocked) as exc:
        guard.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="MARKET",
            quantity=0.01,
        )

    assert "live_adapter_not_active" in exc.value.reasons
    assert adapter.orders == []


def test_testnet_live_order_passes_all_gates_and_cap():
    adapter = FakeAdapter(mode="testnet", price=50_000)
    guard = _guard(
        adapter,
        env=_live_env(LIVE_MAX_ORDER_NOTIONAL_USDT="1000"),
    )

    result = guard.place_order(
        symbol="BTCUSDT",
        side="BUY",
        order_type="MARKET",
        quantity=0.01,
    )

    assert result["status"] == "FILLED"
    assert len(adapter.orders) == 1


def test_symbol_allowlist_blocks_unapproved_asset():
    adapter = FakeAdapter(mode="testnet")
    guard = _guard(adapter)

    with pytest.raises(LiveExecutionBlocked) as exc:
        guard.place_order(
            symbol="SOLUSDT",
            side="BUY",
            order_type="MARKET",
            quantity=0.1,
        )

    assert exc.value.reasons == ("symbol_not_allowed",)


def test_notional_cap_blocks_oversized_order():
    adapter = FakeAdapter(mode="testnet", price=50_000)
    guard = _guard(adapter)

    with pytest.raises(LiveExecutionBlocked) as exc:
        guard.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="MARKET",
            quantity=0.01,
        )

    assert exc.value.reasons == ("order_notional_exceeds_cap",)


def test_guardian_halt_blocks_new_live_order():
    adapter = FakeAdapter(mode="testnet")
    guard = _guard(adapter, guardian_halted=True)

    with pytest.raises(LiveExecutionBlocked) as exc:
        guard.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="MARKET",
            quantity=0.01,
        )

    assert "guardian_halted" in exc.value.reasons


def test_mainnet_requires_both_mainnet_flags():
    report = build_live_readiness_report(
        trading_mode="live",
        network="mainnet",
        adapter_mode="mainnet",
        guardian_halted=False,
        backend_api_key_configured=True,
        env=_live_env(
            LIVE_TESTNET_ENABLED="false",
            LIVE_MAINNET_ENABLED="false",
            ALLOW_MAINNET="false",
        ),
    )

    assert report.allowed is False
    assert "allow_mainnet_disabled" in report.reasons
    assert "live_mainnet_disabled" in report.reasons


def test_mainnet_can_only_become_ready_with_explicit_dual_opt_in():
    report = build_live_readiness_report(
        trading_mode="live",
        network="mainnet",
        adapter_mode="mainnet",
        guardian_halted=False,
        backend_api_key_configured=True,
        env=_live_env(
            LIVE_TESTNET_ENABLED="false",
            LIVE_MAINNET_ENABLED="true",
            ALLOW_MAINNET="true",
        ),
    )

    assert report.allowed is True
    assert report.reasons == ()


def test_readiness_payload_does_not_expose_approval_or_api_key_values():
    env = _live_env(LIVE_APPROVAL_ID="secret-approval-value")
    report = build_live_readiness_report(
        trading_mode="live",
        network="testnet",
        adapter_mode="testnet",
        guardian_halted=False,
        backend_api_key_configured=True,
        env=env,
    ).to_dict()

    serialized = repr(report)
    assert "secret-approval-value" not in serialized
    assert report["approval_id_configured"] is True
