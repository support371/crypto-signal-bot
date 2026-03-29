"""
FastAPI backend for the Crypto Signal Bot.

Endpoints:
- GET  /health          — System health + kill switch status
- GET  /config          — Current config (sanitized)
- GET  /balance         — Paper portfolio balances
- GET  /orders          — Open paper orders
- GET  /price           — Current market price for a symbol
- GET  /audit           — Persisted audit trail
- GET  /metrics         — Prometheus metrics
- POST /market-state    — Backend-owned signal/risk/microstructure snapshot
- POST /intent/live     — Submit a live trading intent (routes to paper in paper mode)
- POST /intent/paper    — Submit a paper trading intent (always paper)
- POST /withdraw        — Profit withdrawal (paper only)
- WS   /ws/updates      — Real-time order status and health updates

All logic is paper-only. No real exchange connections.
"""

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.logic.audit_store import (
    append_intent,
    append_order,
    append_risk_event,
    append_withdrawal,
    get_audit,
)
from backend.logic.paper_trading import (
    PaperPortfolio,
    _synthetic_price,
    simulate_fill,
)
from backend.logic.risk import compute_risk_score, risk_gate
from backend.logic.signals import build_signal
from backend.logic.simulate import StepResult, simulate_session
from backend.models.execution_intent import (
    ExecutionIntent,
    IntentRequest,
    IntentResponse,
    IntentStatus,
    Side,
)
from backend.models_core import Features

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
_env_path = os.path.join(os.path.dirname(__file__), "env", ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path)
load_dotenv()

TRADING_MODE = os.getenv("TRADING_MODE", "paper")
NETWORK = os.getenv("NETWORK", "testnet")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Crypto Signal Bot — Trading Backend", version="2.1.0")

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:8080,http://localhost:3000",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
paper_portfolio = PaperPortfolio()
kill_switch_active = False
kill_switch_reason: Optional[str] = None
api_error_count = 0
failed_order_count = 0
ws_clients: Set[WebSocket] = set()

# ---------------------------------------------------------------------------
# Prometheus-style counters (lightweight, no dependency needed at import time)
# ---------------------------------------------------------------------------
try:
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, generate_latest

    orders_total = Counter("orders_total", "Total orders submitted", ["side", "mode"])
    risk_blocks_total = Counter("risk_blocks_total", "Total risk-blocked intents")
    pnl_realized = Gauge("pnl_realized", "Realized PnL")
    pnl_unrealized = Gauge("pnl_unrealized", "Unrealized PnL")
    kill_switch_triggers = Counter("kill_switch_triggers", "Kill switch activations")
    api_errors_total = Counter("api_errors_total", "API errors")
    _prometheus_available = True
except ImportError:
    _prometheus_available = False

# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------


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


class WithdrawRequest(BaseModel):
    asset: str = "USDT"
    amount: float = 100.0
    address: str = "paper-wallet"


class MarketStateRequest(BaseModel):
    symbol: str = "BTCUSDT"
    price: float = Field(..., gt=0)
    change24h: float = 0.0
    volume24h: float = 0.0
    marketCap: float = 0.0
    riskTolerance: float = Field(0.5, ge=0.0, le=1.0)
    spreadStressThreshold: float = Field(0.002, gt=0.0)
    volatilitySensitivity: float = Field(0.5, ge=0.0, le=2.0)
    positionSizeFraction: float = Field(0.1, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------


class ExchangeAPIError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        self.message = message
        self.status_code = status_code


class RateLimitError(Exception):
    def __init__(self, retry_after: float = 60.0):
        self.retry_after = retry_after


@app.exception_handler(ExchangeAPIError)
async def exchange_error_handler(request, exc: ExchangeAPIError):
    global api_error_count
    api_error_count += 1
    if _prometheus_available:
        api_errors_total.inc()
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "exchange_error", "message": exc.message},
    )


@app.exception_handler(RateLimitError)
async def rate_limit_handler(request, exc: RateLimitError):
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit",
            "message": "Rate limited. Try again later.",
            "retry_after": exc.retry_after,
        },
    )


@app.exception_handler(Exception)
async def general_error_handler(request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": str(exc)},
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def broadcast(message: Dict[str, Any]):
    dead: List[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.discard(ws)


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def _derive_market_features(
    *,
    change24h: float,
    volume24h: float,
    market_cap: float,
    spread_stress_threshold: float,
    volatility_sensitivity: float,
) -> Tuple[Features, Dict[str, Any]]:
    change_ratio = change24h / 100.0
    hourly_velocity = change_ratio / 24.0
    liquidity_ratio = (volume24h / market_cap) if market_cap > 0 else 0.0

    spread_floor = max(0.0005, spread_stress_threshold * 0.35)
    spread_ceiling = max(spread_floor, spread_stress_threshold * 2.5)
    liquidity_stress = max(0.0, 0.03 - liquidity_ratio) * 0.12
    spread_pct = _clamp(
        spread_floor + abs(change_ratio) * 0.08 + liquidity_stress,
        spread_floor,
        max(spread_ceiling, 0.08),
    )

    imbalance = _clamp(change24h / 8.0, -1.0, 1.0)
    depth_decay_internal = _clamp((liquidity_ratio - 0.05) * 4.0, -1.0, 1.0)

    sensitivity = max(0.5, volatility_sensitivity)
    vol_threshold = max(0.03, 0.05 * sensitivity)
    vol_spike = abs(change_ratio) >= vol_threshold
    short_reversal = abs(change24h) <= 1.5 and liquidity_ratio >= 0.02

    features = Features(
        spread_pct=spread_pct,
        imbalance=imbalance,
        mid_vel=hourly_velocity,
        depth_decay=depth_decay_internal,
        vol_spike=vol_spike,
        short_reversal=short_reversal,
    )

    microstructure = {
        "spreadPercentage": round(spread_pct, 6),
        "orderBookImbalance": round(imbalance, 4),
        "midPriceVelocity": round(change24h / 24.0, 4),
        "volatilitySpike": vol_spike,
        "depthDecay": round(_clamp((depth_decay_internal + 1.0) / 2.0, 0.0, 1.0), 4),
    }
    return features, microstructure


def _check_kill_switch():
    if kill_switch_active:
        raise HTTPException(
            status_code=503,
            detail=f"Kill switch active: {kill_switch_reason}",
        )


def _process_intent(req: IntentRequest, mode: str) -> IntentResponse:
    global failed_order_count

    intent = ExecutionIntent(
        symbol=req.symbol.upper(),
        side=req.side,
        order_type=req.order_type,
        quantity=req.quantity,
        price=req.price,
        time_in_force=req.time_in_force,
        mode=mode,
    )

    feats = Features(
        spread_pct=0.02,
        imbalance=0.1 if req.side == Side.BUY else -0.1,
        mid_vel=0.001,
        depth_decay=0.0,
        vol_spike=False,
        short_reversal=False,
    )
    risk_score = compute_risk_score(feats)

    if risk_score >= 70.0:
        intent.status = IntentStatus.RISK_REJECTED
        intent.notes = f"Risk score too high: {risk_score:.1f}"
        if _prometheus_available:
            risk_blocks_total.inc()
        append_risk_event(
            {
                "intent_id": intent.id,
                "risk_score": risk_score,
                "reason": intent.notes,
            }
        )
        append_intent(intent.model_dump())
        return IntentResponse(
            id=intent.id,
            status=intent.status.value,
            notes=intent.notes,
        )

    intent.status = IntentStatus.RISK_APPROVED

    market_price = _synthetic_price(intent.symbol)
    intent = simulate_fill(intent, paper_portfolio, market_price)

    if intent.status == IntentStatus.FAILED:
        failed_order_count += 1

    if _prometheus_available:
        orders_total.labels(side=intent.side.value, mode=mode).inc()

    intent_data = intent.model_dump()
    append_intent(intent_data)
    if intent.status == IntentStatus.FILLED:
        append_order(intent_data)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(
                broadcast(
                    {
                        "type": "order_update",
                        "intent_id": intent.id,
                        "status": intent.status.value,
                        "symbol": intent.symbol,
                        "side": intent.side.value,
                        "fill_price": intent.fill_price,
                    }
                )
            )
    except RuntimeError:
        pass

    return IntentResponse(
        id=intent.id,
        status=intent.status.value,
        notes=intent.notes,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {
        "kill_switch_active": kill_switch_active,
        "kill_switch_reason": kill_switch_reason,
        "api_error_count": api_error_count,
        "failed_order_count": failed_order_count,
        "halted": kill_switch_active,
        "mode": TRADING_MODE,
    }


@app.get("/config")
def get_config():
    return {
        "trading_mode": TRADING_MODE,
        "network": NETWORK,
        "cors_origins": ALLOWED_ORIGINS,
        "kill_switch_active": kill_switch_active,
    }


@app.get("/balance")
def get_balance():
    return {
        "balances": paper_portfolio.get_all_balances(),
        "positions": paper_portfolio.get_positions(),
    }


@app.get("/orders")
def get_orders(symbol: Optional[str] = Query(None)):
    orders = paper_portfolio.open_orders
    if symbol:
        orders = [o for o in orders if o.symbol == symbol.upper()]
    return {
        "orders": [
            {
                "id": o.id,
                "symbol": o.symbol,
                "side": o.side.value,
                "order_type": o.order_type.value,
                "quantity": o.quantity,
                "price": o.price,
                "status": o.status.value,
                "created_at": o.created_at,
            }
            for o in orders
        ]
    }


@app.get("/price")
def get_price(symbol: str = Query("BTCUSDT")):
    price = _synthetic_price(symbol.upper())
    return {
        "symbol": symbol.upper(),
        "price": round(price, 8),
        "timestamp": time.time(),
    }


@app.get("/audit")
def get_audit_trail():
    return get_audit()


@app.get("/metrics")
def get_metrics():
    if _prometheus_available:
        return JSONResponse(
            content=generate_latest().decode("utf-8"),
            media_type=CONTENT_TYPE_LATEST,
        )
    return {"message": "prometheus_client not installed"}


@app.post("/market-state")
def market_state(req: MarketStateRequest):
    features, microstructure = _derive_market_features(
        change24h=req.change24h,
        volume24h=req.volume24h,
        market_cap=req.marketCap,
        spread_stress_threshold=req.spreadStressThreshold,
        volatility_sensitivity=req.volatilitySensitivity,
    )

    signal = build_signal(features)
    raw_risk_score = compute_risk_score(features)
    tolerance_adjustment = (req.riskTolerance - 0.5) * 20.0
    effective_risk_score = _clamp(raw_risk_score - tolerance_adjustment, 0.0, 100.0)
    decision = risk_gate(
        signal,
        effective_risk_score,
        base_fraction=req.positionSizeFraction,
    )

    reasoning = decision.reason
    if kill_switch_active:
        reasoning = f"{reasoning}. Trading halted: {kill_switch_reason or 'kill switch active'}"

    return {
        "symbol": req.symbol.upper(),
        "price": req.price,
        "signal": {
            "direction": signal.direction,
            "confidence": int(round(signal.confidence * 100)),
            "regime": signal.regime,
            "horizon": signal.horizon_minutes,
        },
        "risk": {
            "score": int(round(effective_risk_score)),
            "decision": decision.intent,
            "approved": decision.approved and not kill_switch_active,
            "positionSize": decision.size_fraction if not kill_switch_active else 0.0,
            "reasoning": reasoning,
        },
        "microstructure": microstructure,
        "backend": {
            "mode": TRADING_MODE,
            "killSwitchActive": kill_switch_active,
            "killSwitchReason": kill_switch_reason,
        },
    }


@app.post("/intent/live", response_model=IntentResponse)
def intent_live(req: IntentRequest):
    _check_kill_switch()
    mode = "live" if TRADING_MODE == "live" else "paper"
    return _process_intent(req, mode)


@app.post("/intent/paper", response_model=IntentResponse)
def intent_paper(req: IntentRequest):
    return _process_intent(req, "paper")


@app.post("/withdraw")
def withdraw(req: WithdrawRequest):
    balance = paper_portfolio.get_balance(req.asset)
    if balance < req.amount:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient {req.asset} balance: {balance:.2f} < {req.amount:.2f}",
        )
    paper_portfolio.balances[req.asset] = balance - req.amount

    withdrawal_data = {
        "asset": req.asset,
        "amount": req.amount,
        "address": req.address,
        "timestamp": time.time(),
    }
    append_withdrawal(withdrawal_data)
    return {"status": "ok", "withdrawal": withdrawal_data}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------


@app.websocket("/ws/updates")
async def websocket_updates(ws: WebSocket):
    await ws.accept()
    ws_clients.add(ws)
    logger.info("WebSocket client connected (%d total)", len(ws_clients))
    try:
        await ws.send_json(
            {
                "type": "health",
                "kill_switch_active": kill_switch_active,
                "mode": TRADING_MODE,
                "api_error_count": api_error_count,
            }
        )
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await ws.send_json(
                    {
                        "type": "health",
                        "kill_switch_active": kill_switch_active,
                        "mode": TRADING_MODE,
                        "api_error_count": api_error_count,
                    }
                )
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)
        logger.info("WebSocket client disconnected (%d remaining)", len(ws_clients))


# ---------------------------------------------------------------------------
# Legacy endpoints (preserved from v1)
# ---------------------------------------------------------------------------


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
        signal={
            "direction": signal.direction,
            "confidence": signal.confidence,
            "regime": signal.regime,
            "horizon_minutes": signal.horizon_minutes,
            "meta": signal.meta,
        },
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
                signal={
                    "direction": s.signal.direction,
                    "confidence": s.signal.confidence,
                    "regime": s.signal.regime,
                    "meta": s.signal.meta,
                },
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
