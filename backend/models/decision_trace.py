"""
Deterministic decision trace model.

Every trading decision emits a structured trace from signal detection through
risk evaluation to execution. Traces enable auditability, determinism
verification, and debugging.
"""

import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SignalSnapshot(BaseModel):
    """Signal classification at decision time."""
    regime: str = "UNKNOWN"
    direction: str = "NEUTRAL"
    confidence: float = 0.0
    horizon_minutes: int = 0


class RuleTrace(BaseModel):
    """Result from a single risk rule evaluation."""
    rule_name: str
    passed: bool
    reason: str
    size_multiplier: float = 1.0


class RiskSnapshot(BaseModel):
    """Risk evaluation result at decision time."""
    score: float = 0.0
    rules_evaluated: List[RuleTrace] = Field(default_factory=list)
    approved: bool = False
    combined_size_multiplier: float = 1.0
    adjusted_quantity: Optional[float] = None
    rejection_reasons: List[str] = Field(default_factory=list)


class ExecutionSnapshot(BaseModel):
    """Execution result of the intent."""
    status: str = "PENDING"
    fill_price: Optional[float] = None
    fill_quantity: Optional[float] = None
    slippage_pct: Optional[float] = None
    adapter: str = "paper"
    notes: Optional[str] = None


class GuardianSnapshot(BaseModel):
    """Guardian/safety state at decision time."""
    kill_switch_active: bool = False
    kill_switch_reason: Optional[str] = None
    guardian_triggered: bool = False
    drawdown_pct: float = 0.0
    api_error_count: int = 0
    failed_order_count: int = 0


class DecisionTrace(BaseModel):
    """Full structured trace for a single trading decision."""
    trace_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    intent_id: str = ""
    timestamp: float = Field(default_factory=time.time)

    # Input context
    symbol: str = ""
    side: str = ""
    quantity: float = 0.0
    price: float = 0.0
    mode: str = "paper"

    # Signal stage
    signal: SignalSnapshot = Field(default_factory=SignalSnapshot)

    # Risk stage
    risk: RiskSnapshot = Field(default_factory=RiskSnapshot)

    # Execution stage
    execution: ExecutionSnapshot = Field(default_factory=ExecutionSnapshot)

    # Guardian state
    guardian: GuardianSnapshot = Field(default_factory=GuardianSnapshot)

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()
