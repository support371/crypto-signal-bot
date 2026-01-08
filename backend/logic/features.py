"""
Feature computation logic.

Transforms a sliding window of MarketTick data into a Features object.
"""

from typing import List, Optional
import statistics

from backend.simulation.models import MarketTick, Features


def compute_features(window: List[MarketTick],
                     prev_depth: Optional[float]) -> Features:
    """
    Compute simple microstructure-style features from a list of ticks.

    - spread_pct
    - imbalance
    - mid_vel
    - depth_decay
    - vol_spike
    - short_reversal
    """
    if len(window) < 2:
        # Cold start: neutral features
        return Features(
            spread_pct=0.0,
            imbalance=0.0,
            mid_vel=0.0,
            depth_decay=0.0,
            vol_spike=False,
            short_reversal=False,
        )

    last = window[-1]
    prev = window[-2]

    mid = (last.bid + last.ask) / 2
    spread = last.ask - last.bid
    spread_pct = spread / mid if mid > 0 else 0.0

    # Order book imbalance: (bid_size - ask_size) / (bid_size + ask_size)
    denom = last.bid_size + last.ask_size
    imbalance = (last.bid_size - last.ask_size) / denom if denom > 0 else 0.0

    # Mid-price velocity (simple slope)
    prev_mid = (prev.bid + prev.ask) / 2
    mid_vel = (mid - prev_mid) / prev_mid if prev_mid > 0 else 0.0

    # Depth decay: compare current depth vs previous average depth
    current_depth = last.bid_size + last.ask_size
    if prev_depth is None or prev_depth <= 0:
        depth_decay = 0.0
    else:
        depth_decay = (current_depth - prev_depth) / prev_depth

    # Volatility spike: compare short vs long std dev of mids
    mids = [(t.bid + t.ask) / 2 for t in window]
    vol_spike = False
    if len(mids) >= 10:
        short = mids[-5:]
        long_ = mids[-10:]
        short_vol = statistics.pstdev(short) if len(short) > 1 else 0.0
        long_vol = statistics.pstdev(long_) if len(long_) > 1 else 0.0
        if long_vol > 0 and short_vol / long_vol > 1.8:
            vol_spike = True

    # Short reversal: last move opposes recent multi-tick trend
    short_reversal = False
    if len(mids) >= 6:
        older = mids[-6:-1]  # previous 5 mids
        if older[0] != older[-1]:
            trend_sign = 1 if older[-1] > older[0] else -1
            last_change = mids[-1] - mids[-2]
            if trend_sign * last_change < 0:
                short_reversal = True

    return Features(
        spread_pct=spread_pct,
        imbalance=imbalance,
        mid_vel=mid_vel,
        depth_decay=depth_decay,
        vol_spike=vol_spike,
        short_reversal=short_reversal,
    )
