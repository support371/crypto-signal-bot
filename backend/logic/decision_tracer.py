# backend/logic/decision_tracer.py
"""
DecisionTracer — in-memory ring buffer for all trading decisions.

Traces every BUY, SELL, and HOLD decision made by the signal executor.
HOLD traces are critical for auditing why positions are NOT being opened
(confidence below threshold, max positions reached, Guardian active, etc.).

The ring buffer is bounded by settings.trace_max_entries to prevent unbounded memory growth.
Access traces via:
  - get_recent_traces(n)   → last n traces
  - get_traces_for_symbol  → filtered by symbol
  - get_hold_traces        → only HOLD decisions (why nothing happened)
  - flush                  → clear for testing

Thread safety: uses a simple list with bounded size. Single-threaded asyncio
event loop means no concurrent writes in practice.
"""
from __future__ import annotations

import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional

from backend.config.settings import get_settings


@dataclass
class HoldReason:
    """Structured reason for a HOLD (no-trade) decision."""
    code: str          # e.g. "LOW_CONFIDENCE", "MAX_POSITIONS", "GUARDIAN_TRIGGERED"
    description: str
    threshold: Optional[float] = None
    actual: Optional[float] = None


@dataclass
class TraceEntry:
    """A single decision trace entry. Immutable after creation."""
    trace_id: str
    timestamp: float
    symbol: str
    decision: str              # "BUY" | "SELL" | "CLOSE" | "HOLD"
    side: Optional[str]        # "BUY" | "SELL" | None (for HOLD/CLOSE)
    confidence: float
    strategy_id: str
    signal_side: str           # raw signal from engine
    equity: float
    notional: float
    mode: str

    # HOLD-specific
    hold_reasons: List[HoldReason] = field(default_factory=list)

    # Execution result (only BUY/SELL/CLOSE)
    fill_price: Optional[float] = None
    fill_quantity: Optional[float] = None
    fill_status: Optional[str] = None
    fill_error: Optional[str] = None

    # Config snapshot at decision time (reproducibility)
    config_snapshot_hash: Optional[str] = None
    min_confidence_threshold: float = 0.75
    max_positions: int = 4
    position_pct: float = 0.05

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trace_id": self.trace_id,
            "timestamp": self.timestamp,
            "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.timestamp)),
            "symbol": self.symbol,
            "decision": self.decision,
            "side": self.side,
            "confidence": self.confidence,
            "strategy_id": self.strategy_id,
            "signal_side": self.signal_side,
            "equity": self.equity,
            "notional": self.notional,
            "mode": self.mode,
            "hold_reasons": [
                {
                    "code": r.code,
                    "description": r.description,
                    "threshold": r.threshold,
                    "actual": r.actual,
                }
                for r in self.hold_reasons
            ],
            "fill_price": self.fill_price,
            "fill_quantity": self.fill_quantity,
            "fill_status": self.fill_status,
            "fill_error": self.fill_error,
            "config_snapshot_hash": self.config_snapshot_hash,
            "min_confidence_threshold": self.min_confidence_threshold,
            "max_positions": self.max_positions,
            "position_pct": self.position_pct,
        }


class DecisionTracer:
    """Ring-buffer backed decision tracer."""

    def __init__(self, max_entries: Optional[int] = None) -> None:
        settings = get_settings()
        self._max = max_entries or settings.trace_max_entries
        self._traces: Deque[TraceEntry] = deque(maxlen=self._max)

    def record(self, entry: TraceEntry) -> None:
        self._traces.append(entry)

    def get_recent(self, n: int = 50) -> List[Dict[str, Any]]:
        entries = list(self._traces)
        return [e.to_dict() for e in entries[-n:]][::-1]  # newest first

    def get_for_symbol(self, symbol: str, n: int = 50) -> List[Dict[str, Any]]:
        entries = [e for e in self._traces if e.symbol == symbol]
        return [e.to_dict() for e in entries[-n:]][::-1]

    def get_hold_traces(self, n: int = 50) -> List[Dict[str, Any]]:
        holds = [e for e in self._traces if e.decision == "HOLD"]
        return [e.to_dict() for e in holds[-n:]][::-1]

    def get_stats(self) -> Dict[str, Any]:
        entries = list(self._traces)
        total = len(entries)
        if total == 0:
            return {"total": 0, "buy": 0, "sell": 0, "close": 0, "hold": 0, "hold_pct": 0.0}
        counts = {"BUY": 0, "SELL": 0, "CLOSE": 0, "HOLD": 0}
        hold_reason_codes: Dict[str, int] = {}
        for e in entries:
            counts[e.decision] = counts.get(e.decision, 0) + 1
            for r in e.hold_reasons:
                hold_reason_codes[r.code] = hold_reason_codes.get(r.code, 0) + 1
        return {
            "total": total,
            "buy": counts.get("BUY", 0),
            "sell": counts.get("SELL", 0),
            "close": counts.get("CLOSE", 0),
            "hold": counts.get("HOLD", 0),
            "hold_pct": round(counts.get("HOLD", 0) / total * 100, 1),
            "hold_reason_breakdown": hold_reason_codes,
        }

    def flush(self) -> None:
        """Clear all traces. For testing only."""
        self._traces.clear()

    def make_entry(
        self,
        *,
        symbol: str,
        decision: str,
        side: Optional[str],
        confidence: float,
        strategy_id: str,
        signal_side: str,
        equity: float,
        notional: float,
        mode: str,
        hold_reasons: Optional[List[HoldReason]] = None,
        fill_price: Optional[float] = None,
        fill_quantity: Optional[float] = None,
        fill_status: Optional[str] = None,
        fill_error: Optional[str] = None,
        config_snapshot_hash: Optional[str] = None,
    ) -> TraceEntry:
        settings = get_settings()
        return TraceEntry(
            trace_id=str(uuid.uuid4()),
            timestamp=time.time(),
            symbol=symbol,
            decision=decision,
            side=side,
            confidence=confidence,
            strategy_id=strategy_id,
            signal_side=signal_side,
            equity=equity,
            notional=notional,
            mode=mode,
            hold_reasons=hold_reasons or [],
            fill_price=fill_price,
            fill_quantity=fill_quantity,
            fill_status=fill_status,
            fill_error=fill_error,
            config_snapshot_hash=config_snapshot_hash,
            min_confidence_threshold=settings.executor_min_confidence,
            max_positions=settings.executor_max_positions,
            position_pct=settings.executor_position_pct,
        )


# Singleton tracer — import and use directly
decision_tracer = DecisionTracer()
