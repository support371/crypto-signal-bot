"""Price and signal utilities."""

import time
from typing import Any, Dict, Optional
from backend.logic.risk import compute_risk_score, risk_gate
from backend.logic.signals import build_signal
from backend.models_core import Features
from backend.config.runtime import get_runtime_config

RUNTIME_CONFIG = get_runtime_config()
TRADING_MODE = RUNTIME_CONFIG.trading_mode

def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))

def _derive_market_features(
    *,
    change24h: float,
    volume24h: float,
    market_cap: float,
    spread_stress_threshold: float,
    volatility_sensitivity: float,
) -> tuple[Features, Dict[str, Any]]:
    change_ratio = change24h / 100.0
    hourly_velocity = change_ratio / 24.0
    liquidity_ratio = (volume24h / market_cap) if market_cap > 0 else 0.0
    spread_floor = max(0.0005, spread_stress_threshold * 0.35)
    spread_ceiling = max(spread_floor, spread_stress_threshold * 2.5)
    liquidity_stress = max(0.0, 0.03 - liquidity_ratio) * 0.12
    spread_pct = _clamp(
        spread_floor + abs(change_ratio) * 0.08 + liquidity_stress,
        spread_floor,
        max(spread_ceiling, 0.08),
    )
    imbalance = _clamp(change24h / 8.0, -1.0, 1.0)
    depth_decay_internal = _clamp((liquidity_ratio - 0.05) * 4.0, -1.0, 1.0)
    sensitivity = max(0.5, volatility_sensitivity)
    vol_threshold = max(0.03, 0.05 * sensitivity)
    vol_spike = abs(change_ratio) >= vol_threshold
    short_reversal = abs(change24h) <= 1.5 and liquidity_ratio >= 0.02
    features = Features(
        spread_pct=spread_pct,
        imbalance=imbalance,
        mid_vel=hourly_velocity,
        depth_decay=depth_decay_internal,
        vol_spike=vol_spike,
        short_reversal=short_reversal,
    )
    microstructure = {
        "spreadPercentage": round(spread_pct, 6),
        "orderBookImbalance": round(imbalance, 4),
        "midPriceVelocity": round(change24h / 24.0, 4),
        "volatilitySpike": vol_spike,
        "depthDecay": round(_clamp((depth_decay_internal + 1.0) / 2.0, 0.0, 1.0), 4),
    }
    return features, microstructure

def build_market_state_result(
    *,
    symbol: str,
    price: float,
    change24h: float,
    volume24h: float,
    market_cap: float,
    risk_tolerance: float = 0.5,
    spread_stress_threshold: float = 0.002,
    volatility_sensitivity: float = 0.5,
    position_size_fraction: float = 0.1,
    market_data_source: str = "synthetic",
) -> Dict[str, Any]:
    features, microstructure = _derive_market_features(
        change24h=change24h,
        volume24h=volume24h,
        market_cap=market_cap,
        spread_stress_threshold=spread_stress_threshold,
        volatility_sensitivity=volatility_sensitivity,
    )
    signal = build_signal(features)
    raw_risk_score = compute_risk_score(features)
    tolerance_adjustment = (risk_tolerance - 0.5) * 20.0
    effective_risk_score = _clamp(raw_risk_score - tolerance_adjustment, 0.0, 100.0)
    decision = risk_gate(signal, effective_risk_score, base_fraction=position_size_fraction)
    reasoning = decision.reason

    from backend.logic import context
    if context.kill_switch_active:
        reasoning = f"{reasoning}. Trading halted: {context.kill_switch_reason or 'kill switch active'}"
    return {
        "symbol": symbol.upper(),
        "price": price,
        "signal": {
            "direction": signal.direction,
            "confidence": int(round(signal.confidence * 100)),
            "regime": signal.regime,
            "horizon": signal.horizon_minutes,
        },
        "risk": {
            "score": int(round(effective_risk_score)),
            "decision": decision.intent,
            "approved": decision.approved and not context.kill_switch_active,
            "positionSize": decision.size_fraction if not context.kill_switch_active else 0.0,
            "reasoning": reasoning,
        },
        "microstructure": microstructure,
        "backend": {
            "mode": TRADING_MODE,
            "killSwitchActive": context.kill_switch_active,
            "killSwitchReason": context.kill_switch_reason,
            "marketDataSource": market_data_source,
        },
    }

def get_signal_latest(symbol: Optional[str] = None):
    from backend.logic import context
    if symbol:
        normalized_symbol = symbol.upper()
        signal = context.latest_signal_by_symbol.get(normalized_symbol)
        if signal is None:
            return {"available": False, "message": f"No signal cached yet for {normalized_symbol}.", "symbol": normalized_symbol}
        return {"available": True, "timestamp": context.latest_signal_ts_by_symbol.get(normalized_symbol), **signal}
    if not context.latest_signal_by_symbol:
        return {"available": False, "message": "No signal computed yet. POST to /market-state first."}
    if len(context.latest_signal_by_symbol) > 1:
        return {"available": False, "message": "Multiple symbols available; request /signal/latest?symbol=...", "symbols": sorted(context.latest_signal_by_symbol.keys())}
    symbol_only = next(iter(context.latest_signal_by_symbol.keys()))
    signal = context.latest_signal_by_symbol[symbol_only]
    return {"available": True, "timestamp": context.latest_signal_ts_by_symbol.get(symbol_only), **signal}
