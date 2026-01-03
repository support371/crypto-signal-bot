"""
Deterministic Market Posture Engine.
"""
from backend.contracts.schemas import Signal, MarketPosture

def calculate_posture(
    signal: Signal,
    is_data_stale: bool,
    confidence_threshold: float = 0.55
) -> MarketPosture:
    reasons = []
    if is_data_stale:
        reasons.append("Market data is stale or gapped.")
        return MarketPosture(status="RED", reasons=reasons)
    if signal.regime == "CHAOS":
        reasons.append(f"Market regime is '{signal.regime}'.")
    if signal.confidence < confidence_threshold:
        reasons.append(f"Signal confidence ({signal.confidence:.2f}) is below threshold ({confidence_threshold}).")
    if reasons:
        return MarketPosture(status="AMBER", reasons=reasons)
    reasons.append("Signal is clear and data is fresh.")
    return MarketPosture(status="GREEN", reasons=reasons)
