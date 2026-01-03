"""
FastAPI backend for the Lovable AI Crypto Risk Agent.

Endpoints:
- GET  /health
- POST /analyze-features
- POST /simulate-session

All logic is paper-only. No real trading or exchange APIs.
"""

from typing import Dict, Any, List

from fastapi import FastAPI
from pydantic import BaseModel

from backend.models import Features
from backend.logic.signals import build_signal
from backend.logic.risk import compute_risk_score, risk_gate
from backend.logic.simulate import simulate_session, StepResult


app = FastAPI(title="Lovable AI Crypto Risk Agent", version="1.0.0")


# ---------- Pydantic models for API ----------

class FeaturesIn(BaseModel):
    spread_pct: float = 0.02
    imbalance: float = 0.0
    mid_vel: float = 0.0
    depth_decay: float = 0.0
    vol_spike: bool = False
    short_reversal: bool = False


class AnalyzeResponse(BaseModel):
    signal: Dict[str, Any]
    risk_score: float
    decision: Dict[str, Any]


class SimulateRequest(BaseModel):
    steps: int = 30
    start_price: float = 30000.0
    symbol: str = "BTC/USDT"


class SimStepOut(BaseModel):
    step: int
    price: float
    signal: Dict[str, Any]
    risk_score: float
    decision: Dict[str, Any]


class SimulateResponse(BaseModel):
    symbol: str
    steps: List[SimStepOut]


# ---------- Endpoints ----------

@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "mode": "paper_only"}


@app.post("/analyze-features", response_model=AnalyzeResponse)
def analyze_features(payload: FeaturesIn) -> AnalyzeResponse:
    feats = Features(
        spread_pct=payload.spread_pct,
        imbalance=payload.imbalance,
        mid_vel=payload.mid_vel,
        depth_decay=payload.depth_decay,
        vol_spike=payload.vol_spike,
        short_reversal=payload.short_reversal,
    )
    signal = build_signal(feats)
    risk_score = compute_risk_score(feats)
    decision = risk_gate(signal, risk_score)

    return AnalyzeResponse(
        signal=signal.model_dump(),
        risk_score=risk_score,
        decision={
            "intent": decision.intent,
            "approved": decision.approved,
            "size_fraction": decision.size_fraction,
            "reason": decision.reason,
            "risk_score": decision.risk_score,
        },
    )


@app.post("/simulate-session", response_model=SimulateResponse)
def simulate_session_api(req: SimulateRequest) -> SimulateResponse:
    internal_steps: List[StepResult] = simulate_session(req.steps, req.start_price)

    steps_out: List[SimStepOut] = []
    for s in internal_steps:
        steps_out.append(
            SimStepOut(
                step=s.step,
                price=s.price,
                signal=s.signal.model_dump(),
                risk_score=s.risk_score,
                decision={
                    "intent": s.decision.intent,
                    "approved": s.decision.approved,
                    "size_fraction": s.decision.size_fraction,
                    "reason": s.decision.reason,
                    "risk_score": s.decision.risk_score,
                },
            )
        )

    return SimulateResponse(symbol=req.symbol, steps=steps_out)
