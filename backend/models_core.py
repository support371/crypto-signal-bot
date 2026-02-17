"""
Core data models for the Lovable AI Crypto Risk Agent backend.
Paper-only: no real trading logic.
"""

from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class Features:
    """
    Microstructure-style feature vector summarizing the current market state.
    """
    spread_pct: float      # (ask - bid) / mid
    imbalance: float       # (bid_size - ask_size) / (bid_size + ask_size)
    mid_vel: float         # relative change in mid price vs previous
    depth_decay: float     # change in total depth vs previous, negative = shrinking
    vol_spike: bool        # volatility spike flag
    short_reversal: bool   # short-term reversal vs recent trend


@dataclass
class Signal:
    """
    Short-horizon trading signal produced by the signal engine.
    """
    direction: str         # "UP" / "DOWN" / "NEUTRAL"
    confidence: float      # 0.0–1.0
    regime: str            # "TREND" / "RANGE" / "CHAOS"
    horizon_minutes: int
    meta: Dict[str, Any]   # extra info (original feature values, etc.)


@dataclass
class RiskDecision:
    """
    Risk engine decision. Paper-only: intent + size fraction of paper NAV.
    """
    intent: str            # "ENTER_LONG" / "EXIT" / "HOLD"
    approved: bool
    size_fraction: float   # fraction of paper NAV (e.g. 0.01 = 1%)
    reason: str
    risk_score: float      # 0–100


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
