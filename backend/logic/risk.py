"""
Risk engine: compute risk score and decide ENTER / EXIT / HOLD.
Paper-only sizing, no real trading.
"""

from backend.models import Features, Signal, RiskDecision


def compute_risk_score(features: Features) -> float:
    """
    Composite risk score 0–100 from four components:

    - spread_stress: min(spread_pct / 0.10, 1.0) * 25
    - depth_stress: min(max(-depth_decay, 0.0) / 0.20, 1.0) * 25
    - vol_stress: 25 if vol_spike else 0
    - shock_stress: min(abs(mid_vel) / 0.02, 1.0) * 25
    """
    spread_stress = min(features.spread_pct / 0.10, 1.0) * 25.0
    depth_stress = min(max(-features.depth_decay, 0.0) / 0.20, 1.0) * 25.0
    vol_stress = 25.0 if features.vol_spike else 0.0
    shock_stress = min(abs(features.mid_vel) / 0.02, 1.0) * 25.0

    score = spread_stress + depth_stress + vol_stress + shock_stress
    return max(0.0, min(score, 100.0))


def risk_gate(signal: Signal,
              risk_score: float,
              base_fraction: float = 0.01) -> RiskDecision:
    """
    Apply risk policy:

    - If risk_score >= 70 or regime == CHAOS -> HOLD, not approved
    - If direction NEUTRAL or confidence < 0.6 -> HOLD, not approved
    - Otherwise:
      - base_fraction = 1% of NAV
      - risk_mult: 1.0 below 40, linearly down to 0.3 at 70
      - conf_mult: map confidence 0.6–0.8 into ~0.75–1.25
      - final size = base_fraction * risk_mult * conf_mult

      - If direction UP   -> ENTER_LONG
      - If direction DOWN -> EXIT
    """
    # Hard risk-off
    if risk_score >= 70.0 or signal.regime == "CHAOS":
        return RiskDecision(
            intent="HOLD",
            approved=False,
            size_fraction=0.0,
            reason="Risk-off: high risk score or CHAOS regime",
            risk_score=risk_score,
        )

    # Weak or neutral signal
    if signal.direction == "NEUTRAL" or signal.confidence < 0.6:
        return RiskDecision(
            intent="HOLD",
            approved=False,
            size_fraction=0.0,
            reason="Signal not strong enough",
            risk_score=risk_score,
        )

    # Risk multiplier
    if risk_score <= 40.0:
        risk_mult = 1.0
    else:
        # linear drop 1.0 at 40 to 0.3 at 70
        risk_mult = 1.0 - (risk_score - 40.0) / 30.0 * 0.7
        if risk_mult < 0.3:
            risk_mult = 0.3

    # Confidence multiplier: map confidence 0.6–0.8 to ~0.75–1.25
    conf = max(0.0, min(signal.confidence, 1.0))
    if conf <= 0.6:
        conf_mult = 0.75
    elif conf >= 0.8:
        conf_mult = 1.25
    else:
        conf_mult = 0.75 + (conf - 0.6) / 0.2 * (1.25 - 0.75)

    final_fraction = base_fraction * risk_mult * conf_mult

    if signal.direction == "UP":
        intent = "ENTER_LONG"
        reason = "Trend / setup positive with acceptable risk"
    else:
        intent = "EXIT"
        reason = "Downward signal under acceptable risk"

    return RiskDecision(
        intent=intent,
        approved=True,
        size_fraction=round(final_fraction, 4),
        reason=reason,
        risk_score=risk_score,
    )
