"""
Data models for the paper-trading simulation.
"""
from dataclasses import dataclass

@dataclass
class MarketTick:
    """
    Synthetic tick used by the simulator / feature engine.
    """
    ts: float
    price: float
    bid: float
    ask: float
    bid_size: float
    ask_size: float

@dataclass
class Features:
    """
    Microstructure-style feature vector summarizing the current market state.
    """
    spread_pct: float
    imbalance: float
    mid_vel: float
    depth_decay: float
    vol_spike: bool
    short_reversal: bool
