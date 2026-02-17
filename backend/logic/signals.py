"""
Signal engine: classify regime and generate direction + confidence.
"""

from backend.models_core import Features, Signal


def classify_regime(features: Features) -> str:
    """
    Regime rules:

    - CHAOS: vol_spike == True OR spread_pct > 0.08
    - TREND: abs(mid_vel) > 0.005
    - RANGE: otherwise
    """
    if features.vol_spike or features.spread_pct > 0.08:
        return "CHAOS"
    if abs(features.mid_vel) > 0.005:
        return "TREND"
    return "RANGE"


def build_signal(features: Features, horizon_minutes: int = 15) -> Signal:
    """
    Build a short-horizon signal based on features and regime.

    Directions:
    - TREND:
      - mid_vel > 0 and imbalance > 0  -> UP
      - mid_vel < 0 and imbalance < 0  -> DOWN
    - RANGE:
      - short_reversal and depth_decay >= 0:
        - if mid_vel > 0  -> DOWN
        - if mid_vel < 0  -> UP
    - CHAOS:
      - always NEUTRAL, low confidence
    """
    regime = classify_regime(features)

    direction = "NEUTRAL"
    confidence = 0.5

    if regime == "TREND":
        if features.mid_vel > 0 and features.imbalance > 0:
            direction = "UP"
            confidence = 0.65
        elif features.mid_vel < 0 and features.imbalance < 0:
            direction = "DOWN"
            confidence = 0.65

    elif regime == "RANGE":
        if features.short_reversal and features.depth_decay >= 0:
            if features.mid_vel > 0:
                direction = "DOWN"
            elif features.mid_vel < 0:
                direction = "UP"
            confidence = 0.60

    elif regime == "CHAOS":
        direction = "NEUTRAL"
        confidence = 0.30

    return Signal(
        direction=direction,
        confidence=confidence,
        regime=regime,
        horizon_minutes=horizon_minutes,
        meta={
            "spread_pct": round(features.spread_pct, 6),
            "mid_vel": round(features.mid_vel, 6),
            "imbalance": round(features.imbalance, 4),
            "depth_decay": round(features.depth_decay, 4),
            "vol_spike": features.vol_spike,
            "short_reversal": features.short_reversal,
        },
    )
