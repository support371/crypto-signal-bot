"""
Intent Builder (Portfolio Architect Bot)
"""
import uuid
from pydantic import BaseModel, Field
from backend.contracts.schemas import (
    Signal,
    MarketPosture,
    PortfolioState,
    ExecutionIntent
)

class RiskConfig(BaseModel):
    max_gross_exposure: float = Field(..., ge=0.0, le=1.0)
    max_symbol_exposure: float = Field(..., ge=0.0, le=1.0)
    base_sizing_fraction: float = Field(..., gt=0.0, le=0.1)
    amber_size_reduction: float = Field(..., ge=0.1, le=0.9)

def build_intent(
    signal: Signal,
    posture: MarketPosture,
    portfolio: PortfolioState,
    config: RiskConfig,
    symbol: str
) -> ExecutionIntent:
    intent_id = f"intent_{uuid.uuid4()}"
    current_position = portfolio.positions.get(symbol, 0.0)

    if posture.status == "RED":
        if signal.direction == "DOWN" and current_position > 0:
            return ExecutionIntent(intent_id=intent_id, action="REDUCE", symbol=symbol, size_fraction=1.0, reason="RED POSTURE: EXIT ALL", risk_score=100)
        return ExecutionIntent(intent_id=intent_id, action="HOLD", symbol=symbol, size_fraction=0.0, reason=f"RED POSTURE: {posture.reasons[0]}", risk_score=100)

    size_fraction = config.base_sizing_fraction

    if posture.status == "AMBER":
        size_fraction *= config.amber_size_reduction
        reason_prefix = f"AMBER POSTURE ({posture.reasons[0]}): "
    else: # GREEN
        reason_prefix = "GREEN POSTURE: "

    if signal.direction == "UP" and signal.confidence > 0.6:
        if portfolio.exposure + size_fraction > config.max_gross_exposure:
            return ExecutionIntent(intent_id=intent_id, action="HOLD", symbol=symbol, size_fraction=0.0, reason="Gross exposure limit would be exceeded.", risk_score=80)
        if current_position + size_fraction > config.max_symbol_exposure:
             return ExecutionIntent(intent_id=intent_id, action="HOLD", symbol=symbol, size_fraction=0.0, reason="Symbol exposure limit would be exceeded.", risk_score=80)

        return ExecutionIntent(intent_id=intent_id, action="ENTER_LONG", symbol=symbol, size_fraction=round(size_fraction, 4), reason=reason_prefix + "High confidence UP signal.", risk_score=40)

    if signal.direction == "DOWN" and signal.confidence > 0.6:
        if current_position > 0:
            return ExecutionIntent(intent_id=intent_id, action="REDUCE", symbol=symbol, size_fraction=round(size_fraction, 4), reason=reason_prefix + "High confidence DOWN signal.", risk_score=60)

    return ExecutionIntent(intent_id=intent_id, action="HOLD", symbol=symbol, size_fraction=0.0, reason="No strong signal or conditions met.", risk_score=50)
