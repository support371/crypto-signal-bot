"""Fail-closed controls for hosted live exchange execution."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from typing import Callable, Mapping, Optional

_TRUE = {"1", "true", "yes", "on"}


class LiveExecutionBlocked(RuntimeError):
    """A live order failed one or more mandatory safety gates."""

    def __init__(self, reasons):
        self.reasons = tuple(reasons)
        super().__init__("Live execution blocked: " + ", ".join(self.reasons))


@dataclass(frozen=True)
class LiveReadinessReport:
    allowed: bool
    trading_mode: str
    network: str
    adapter_mode: str
    reasons: tuple[str, ...]
    allowed_symbols: tuple[str, ...]
    max_order_notional_usdt: float
    approval_id_configured: bool
    safeguards: dict[str, bool]

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["reasons"] = list(self.reasons)
        payload["allowed_symbols"] = list(self.allowed_symbols)
        return payload


def _flag(env: Mapping[str, str], name: str) -> bool:
    return env.get(name, "").strip().lower() in _TRUE


def _number(env: Mapping[str, str], name: str) -> float:
    try:
        return float(env.get(name, "0"))
    except (TypeError, ValueError):
        return 0.0


def _symbol(value: str) -> str:
    return value.upper().replace("/", "").replace("-", "").strip()


def _symbols(env: Mapping[str, str]) -> tuple[str, ...]:
    return tuple(sorted({_symbol(v) for v in env.get("LIVE_ALLOWED_SYMBOLS", "").split(",") if _symbol(v)}))


def build_live_readiness_report(
    *,
    trading_mode: str,
    network: str,
    adapter_mode: str,
    guardian_halted: bool,
    backend_api_key_configured: bool,
    env: Optional[Mapping[str, str]] = None,
) -> LiveReadinessReport:
    source = env if env is not None else os.environ
    trading_mode = (trading_mode or "paper").strip().lower()
    network = (network or "testnet").strip().lower()
    adapter_mode = (adapter_mode or "paper").strip().lower()

    enabled = _flag(source, "LIVE_EXECUTION_ENABLED")
    approved = _flag(source, "LIVE_OWNER_APPROVED")
    approval_id = bool(source.get("LIVE_APPROVAL_ID", "").strip())
    allow_mainnet = _flag(source, "ALLOW_MAINNET")
    mainnet_enabled = _flag(source, "LIVE_MAINNET_ENABLED")
    testnet_enabled = _flag(source, "LIVE_TESTNET_ENABLED")
    allowed_symbols = _symbols(source)
    max_notional = _number(source, "LIVE_MAX_ORDER_NOTIONAL_USDT")

    reasons: list[str] = []
    if trading_mode != "live":
        reasons.append("trading_mode_not_live")
    if adapter_mode == "paper":
        reasons.append("live_adapter_not_active")
    if not enabled:
        reasons.append("live_execution_disabled")
    if not approved:
        reasons.append("owner_approval_missing")
    if not approval_id:
        reasons.append("approval_id_missing")
    if not backend_api_key_configured:
        reasons.append("backend_api_key_missing")
    if guardian_halted:
        reasons.append("guardian_halted")
    if not allowed_symbols:
        reasons.append("allowed_symbols_missing")
    if max_notional <= 0:
        reasons.append("max_order_notional_invalid")

    if network == "mainnet":
        if not allow_mainnet:
            reasons.append("allow_mainnet_disabled")
        if not mainnet_enabled:
            reasons.append("live_mainnet_disabled")
    elif network == "testnet":
        if not testnet_enabled:
            reasons.append("live_testnet_disabled")
    else:
        reasons.append("unsupported_network")

    safeguards = {
        "live_execution_enabled": enabled,
        "owner_approved": approved,
        "approval_id_configured": approval_id,
        "backend_api_key_configured": backend_api_key_configured,
        "guardian_clear": not guardian_halted,
        "adapter_live": adapter_mode != "paper",
        "symbol_allowlist_configured": bool(allowed_symbols),
        "notional_cap_configured": max_notional > 0,
        "allow_mainnet": allow_mainnet,
        "live_mainnet_enabled": mainnet_enabled,
        "live_testnet_enabled": testnet_enabled,
    }
    return LiveReadinessReport(
        allowed=not reasons,
        trading_mode=trading_mode,
        network=network,
        adapter_mode=adapter_mode,
        reasons=tuple(reasons),
        allowed_symbols=allowed_symbols,
        max_order_notional_usdt=max_notional,
        approval_id_configured=approval_id,
        safeguards=safeguards,
    )


class GuardedExchangeAdapter:
    """Proxy that blocks unsafe live orders before exchange submission."""

    def __init__(
        self,
        delegate,
        *,
        trading_mode: str,
        network: str,
        guardian_halted: Callable[[], bool],
        backend_api_key_configured: Callable[[], bool],
        env: Optional[Mapping[str, str]] = None,
    ):
        self._delegate = delegate
        self._trading_mode = (trading_mode or "paper").strip().lower()
        self._network = (network or "testnet").strip().lower()
        self._guardian_halted = guardian_halted
        self._backend_api_key_configured = backend_api_key_configured
        self._env = env

    @property
    def mode(self) -> str:
        return str(self._delegate.mode)

    @property
    def exchange(self) -> str:
        return str(self._delegate.exchange)

    def readiness(self) -> LiveReadinessReport:
        return build_live_readiness_report(
            trading_mode=self._trading_mode,
            network=self._network,
            adapter_mode=self.mode,
            guardian_halted=bool(self._guardian_halted()),
            backend_api_key_configured=bool(self._backend_api_key_configured()),
            env=self._env,
        )

    def _check_order(self, symbol: str, quantity: float, price: Optional[float]) -> None:
        report = self.readiness()
        if not report.allowed:
            raise LiveExecutionBlocked(report.reasons)
        if _symbol(symbol) not in report.allowed_symbols:
            raise LiveExecutionBlocked(["symbol_not_allowed"])
        try:
            qty = abs(float(quantity))
        except (TypeError, ValueError) as exc:
            raise LiveExecutionBlocked(["invalid_quantity"]) from exc
        if qty <= 0:
            raise LiveExecutionBlocked(["invalid_quantity"])
        reference = self._delegate.get_price(symbol) if price is None else price
        try:
            reference = float(reference)
        except (TypeError, ValueError) as exc:
            raise LiveExecutionBlocked(["invalid_reference_price"]) from exc
        if reference <= 0:
            raise LiveExecutionBlocked(["invalid_reference_price"])
        if qty * reference > report.max_order_notional_usdt:
            raise LiveExecutionBlocked(["order_notional_exceeds_cap"])

    def place_order(self, *, symbol, side, order_type, quantity, price=None):
        if self._trading_mode != "live":
            return self._delegate.place_order(
                symbol=symbol, side=side, order_type=order_type,
                quantity=quantity, price=price,
            )
        self._check_order(symbol, quantity, price)
        return self._delegate.place_order(
            symbol=symbol, side=side, order_type=order_type,
            quantity=quantity, price=price,
        )

    def get_balance(self, asset="USDT"):
        return self._delegate.get_balance(asset)

    def get_price(self, symbol):
        return self._delegate.get_price(symbol)

    def get_order_status(self, order_id, symbol):
        return self._delegate.get_order_status(order_id, symbol)

    def cancel_order(self, order_id, symbol):
        return self._delegate.cancel_order(order_id, symbol)

    def reconcile(self):
        return self._delegate.reconcile()

    def liquidate_all_positions(self):
        if self._trading_mode == "live":
            report = self.readiness()
            if not report.allowed:
                raise LiveExecutionBlocked(report.reasons)
        return self._delegate.liquidate_all_positions()

    def __getattr__(self, name):
        return getattr(self._delegate, name)
