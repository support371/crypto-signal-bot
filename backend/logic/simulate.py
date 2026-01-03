"""
Simple paper-only market simulator.

Generates a random-walk price and synthetic order book,
then passes everything through features -> signal -> risk.
"""

from typing import List, Optional
from dataclasses import dataclass
import random
import time

from backend.models import MarketTick, RiskDecision, Features
from backend.contracts.schemas import Signal
from backend.logic.features import compute_features
from backend.logic.signals import build_signal
from backend.logic.risk import compute_risk_score, risk_gate


@dataclass
class StepResult:
    step: int
    price: float
    signal: Signal
    risk_score: float
    decision: RiskDecision


def simulate_tick(price: float) -> MarketTick:
    """
    Generate a single synthetic tick using a random walk and random depth.
    """
    drift = random.uniform(-0.001, 0.001)  # +/- 0.1%
    price = price * (1.0 + drift)

    spread_abs = price * random.uniform(0.0005, 0.003)  # 5–30 bps
    bid = price - spread_abs / 2.0
    ask = price + spread_abs / 2.0

    bid_size = random.uniform(1.0, 10.0)
    ask_size = random.uniform(1.0, 10.0)

    return MarketTick(
        ts=time.time(),
        price=price,
        bid=bid,
        ask=ask,
        bid_size=bid_size,
        ask_size=ask_size,
    )


def simulate_session(steps: int, start_price: float) -> List[StepResult]:
    """
    Run a synthetic session:

    - random-walk price
    - compute features on sliding window
    - build signal, risk score, and decision for each step
    """
    window: List[MarketTick] = []
    prev_depth: Optional[float] = None
    price = start_price
    results: List[StepResult] = []

    for i in range(steps):
        tick = simulate_tick(price)
        price = tick.price
        window.append(tick)
        if len(window) > 30:
            window.pop(0)

        feats: Features = compute_features(window, prev_depth)
        prev_depth = tick.bid_size + tick.ask_size
        signal = build_signal(feats)
        risk_score = compute_risk_score(feats)
        decision = risk_gate(signal, risk_score)

        results.append(
            StepResult(
                step=i + 1,
                price=price,
                signal=signal,
                risk_score=risk_score,
                decision=decision,
            )
        )

    return results
