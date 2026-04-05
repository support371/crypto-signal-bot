"""
FastAPI backend for the Crypto Signal Bot.

Endpoints:
- GET  /health              — System health + kill switch status
- GET  /config              — Current config (sanitized)
- GET  /balance             — Paper portfolio balances
- GET  /positions           — Open positions
- GET  /orders              — Open paper orders
- GET  /price               — Current market price for a symbol
- GET  /audit               — Persisted audit trail
- GET  /metrics             — Prometheus metrics
- GET  /signal/latest       — Latest signal from last market-state call
- GET  /guardian/status     — Guardian service state
- POST /market-state        — Backend-owned signal/risk/microstructure snapshot
- POST /intent/live         — Submit a live trading intent (routes to paper in paper mode)
- POST /intent/paper        — Submit a paper trading intent (always paper)
- POST /kill-switch         — Activate or deactivate kill switch (requires auth)
- POST /withdraw            — Profit withdrawal (paper only, requires auth)
- WS   /ws/updates          — Real-time order status and health updates

All logic is paper-only by default. No real exchange connections unless explicitly configured.
"""

import asyncio
import logging
import os
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Security, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

from backend.logic.audit_store import (
    append_intent,
    append_order,
    append_risk_event,
    append_withdrawal,
    get_audit,
)
from backend.logic.earnings import (
    get_history as earnings_get_history,
    get_summary as earnings_get_summary,
    record_fill as earnings_record_fill,
    reset_earnings,
)
from backend.logic.exchange_adapter import ExchangeAdapter, build_adapter
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
BACKEND_API_KEY = os.getenv("BACKEND_API_KEY", "")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Crypto Signal Bot — Trading Backend", version="2.2.0")

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
# Auth
# ---------------------------------------------------------------------------
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_auth(api_key: Optional[str] = Security(_api_key_header)):
    """Require API key on POST endpoints when BACKEND_API_KEY is configured."""
    if not BACKEND_API_KEY:
        # No key configured — open (development mode)
        return
    if api_key != BACKEND_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ---------------------------------------------------------------------------
# Rate limiting (simple in-memory sliding window)
# ---------------------------------------------------------------------------
_rate_limit_window_seconds = 60
_rate_limit_max_requests = int(os.getenv("RATE_LIMIT_RPM", "120"))
_rate_limit_store: Dict[str, List[float]] = defaultdict(list)


def rate_limit(request: Request):
    """Allow up to RATE_LIMIT_RPM requests per minute per IP on GET endpoints."""
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    window_start = now - _rate_limit_window_seconds
    timestamps = _rate_limit_store[client_ip]
    # Prune old entries
    _rate_limit_store[client_ip] = [t for t in timestamps if t > window_start]
    if len(_rate_limit_store[client_ip]) >= _rate_limit_max_requests:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Max {_rate_limit_max_requests} requests per minute.",
        )
    _rate_limit_store[client_ip].append(now)


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
paper_portfolio = PaperPortfolio()

# Exchange adapter — resolved once at startup based on env config.
# PaperAdapter is always the default; BinanceCCXTAdapter only when TRADING_MODE=live
# and credentials + ccxt are present.
exchange_adapter: ExchangeAdapter = build_adapter(
    trading_mode=TRADING_MODE,
    network=NETWORK,
    portfolio=paper_portfolio,
    synthetic_price_fn=_synthetic_price,
)

kill_switch_active = False
kill_switch_reason: Optional[str] = None
api_error_count = 0
failed_order_count = 0
ws_clients: Set[WebSocket] = set()

# Latest signal cache (updated on every /market-state call)
_latest_signal: Optional[Dict[str, Any]] = None
_latest_signal_ts: Optional[float] = None

# ---------------------------------------------------------------------------
# Guardian state
# ---------------------------------------------------------------------------
_guardian_triggered = False
_guardian_trigger_reason: Optional[str] = None
_guardian_trigger_ts: Optional[float] = None
_guardian_drawdown_pct: float = 0.0
_guardian_starting_nav: float = 10000.0

_GUARDIAN_MAX_API_ERRORS = int(os.getenv("GUARDIAN_MAX_API_ERRORS", "10"))
_GUARDIAN_MAX_FAILED_ORDERS = int(os.getenv("GUARDIAN_MAX_FAILED_ORDERS", "5"))
_GUARDIAN_MAX_DRAWDOWN_PCT = float(os.getenv("GUARDIAN_MAX_DRAWDOWN_PCT", "0.05"))


def _guardian_evaluate() -> Optional[str]:
    """Evaluate guardian conditions. Returns trigger reason or None."""
    global _guardian_drawdown_pct

    # API errors threshold
    if api_error_count >= _GUARDIAN_MAX_API_ERRORS:
        return f"API error threshold reached ({api_error_count} errors)"

    # Failed order threshold
    if failed_order_count >= _GUARDIAN_MAX_FAILED_ORDERS:
        return f"Failed order threshold reached ({failed_order_count} failures)"

    # Drawdown check
    current_usdt = paper_portfolio.get_balance("USDT")
    if _guardian_starting_nav > 0:
        _guardian_drawdown_pct = max(
            0.0, (_guardian_starting_nav - current_usdt) / _guardian_starting_nav
        )
        if _guardian_drawdown_pct >= _GUARDIAN_MAX_DRAWDOWN_PCT:
            return (
                f"Drawdown limit breached ({_guardian_drawdown_pct*100:.1f}% >= "
                f"{_GUARDIAN_MAX_DRAWDOWN_PCT*100:.1f}%)"
            )

    return None


async def _guardian_check_and_broadcast():
    """Check guardian conditions; activate kill switch and broadcast if triggered."""
    global kill_switch_active, kill_switch_reason
    global _guardian_triggered, _guardian_trigger_reason, _guardian_trigger_ts

    if kill_switch_active:
        return  # Already halted

    reason = _guardian_evaluate()
    if reason:
        kill_switch_active = True
        kill_switch_reason = f"Guardian: {reason}"
        _guardian_triggered = True
        _guardian_trigger_reason = reason
        _guardian_trigger_ts = time.time()
        logger.warning("Guardian triggered kill switch: %s", reason)
        await broadcast(
            {
                "type": "guardian_alert",
                "reason": reason,
                "kill_switch_active": True,
                "timestamp": _guardian_trigger_ts,
            }
        )


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


class KillSwitchRequest(BaseModel):
    activate: bool
    reason: Optional[str] = None


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

    # Dispatch to exchange adapter (paper by default; CCXT testnet/mainnet if configured)
    try:
        result = exchange_adapter.place_order(
            symbol=intent.symbol,
            side=intent.side.value,
            order_type=intent.order_type.value,
            quantity=intent.quantity,
            price=intent.price,
        )
        intent.fill_price = result.get("fill_price")
        intent.fill_quantity = result.get("quantity", intent.quantity)
        intent.notes = result.get("notes", "")
        intent.updated_at = result.get("timestamp", time.time())
        raw_status = result.get("status", "FAILED")
        try:
            intent.status = IntentStatus(raw_status)
        except ValueError:
            intent.status = IntentStatus.FAILED
    except Exception as exc:
        logger.error("Adapter place_order error: %s", exc)
        intent.status = IntentStatus.FAILED
        intent.notes = str(exc)

    if intent.status == IntentStatus.FAILED:
        failed_order_count += 1

    if _prometheus_available:
        orders_total.labels(side=intent.side.value, mode=mode).inc()

    intent_data = intent.model_dump()
    append_intent(intent_data)
    if intent.status == IntentStatus.FILLED:
        append_order(intent_data)
        earnings_record_fill(
            symbol=intent.symbol,
            side=intent.side.value,
            quantity=intent.fill_quantity or intent.quantity,
            fill_price=intent.fill_price or 0.0,
            intent_id=intent.id,
            timestamp=intent.updated_at,
        )

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
            asyncio.ensure_future(_guardian_check_and_broadcast())
    except RuntimeError:
        pass

    return IntentResponse(
        id=intent.id,
        status=intent.status.value,
        notes=intent.notes,
    )


# ---------------------------------------------------------------------------
# Endpoints — GET (rate-limited)
# ---------------------------------------------------------------------------


@app.get("/health", dependencies=[Depends(rate_limit)])
def health():
    return {
        "kill_switch_active": kill_switch_active,
        "kill_switch_reason": kill_switch_reason,
        "api_error_count": api_error_count,
        "failed_order_count": failed_order_count,
        "halted": kill_switch_active,
        "mode": TRADING_MODE,
        "adapter": exchange_adapter.mode,
        "guardian_triggered": _guardian_triggered,
    }


@app.get("/config", dependencies=[Depends(rate_limit)])
def get_config():
    return {
        "trading_mode": TRADING_MODE,
        "network": NETWORK,
        "adapter": exchange_adapter.mode,
        "cors_origins": ALLOWED_ORIGINS,
        "kill_switch_active": kill_switch_active,
        "auth_enabled": bool(BACKEND_API_KEY),
        "rate_limit_rpm": _rate_limit_max_requests,
    }


@app.get("/balance", dependencies=[Depends(rate_limit)])
def get_balance():
    return {
        "balances": paper_portfolio.get_all_balances(),
        "positions": paper_portfolio.get_positions(),
    }


@app.get("/positions", dependencies=[Depends(rate_limit)])
def get_positions():
    return {"positions": paper_portfolio.get_positions()}


@app.get("/orders", dependencies=[Depends(rate_limit)])
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


@app.get("/price", dependencies=[Depends(rate_limit)])
def get_price(symbol: str = Query("BTCUSDT")):
    price = _synthetic_price(symbol.upper())
    return {
        "symbol": symbol.upper(),
        "price": round(price, 8),
        "timestamp": time.time(),
    }


@app.get("/audit", dependencies=[Depends(rate_limit)])
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


@app.get("/signal/latest", dependencies=[Depends(rate_limit)])
def get_signal_latest():
    if _latest_signal is None:
        return {
            "available": False,
            "message": "No signal computed yet. POST to /market-state first.",
        }
    return {
        "available": True,
        "timestamp": _latest_signal_ts,
        **_latest_signal,
    }


@app.get("/guardian/status", dependencies=[Depends(rate_limit)])
def get_guardian_status():
    return {
        "triggered": _guardian_triggered,
        "trigger_reason": _guardian_trigger_reason,
        "trigger_ts": _guardian_trigger_ts,
        "kill_switch_active": kill_switch_active,
        "kill_switch_reason": kill_switch_reason,
        "drawdown_pct": round(_guardian_drawdown_pct * 100, 2),
        "api_error_count": api_error_count,
        "failed_order_count": failed_order_count,
        "thresholds": {
            "max_api_errors": _GUARDIAN_MAX_API_ERRORS,
            "max_failed_orders": _GUARDIAN_MAX_FAILED_ORDERS,
            "max_drawdown_pct": _GUARDIAN_MAX_DRAWDOWN_PCT * 100,
        },
    }


# ---------------------------------------------------------------------------
# Endpoints — POST (authenticated)
# ---------------------------------------------------------------------------


@app.post("/market-state")
def market_state(req: MarketStateRequest):
    global _latest_signal, _latest_signal_ts

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

    result = {
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

    # Cache for /signal/latest
    _latest_signal = result
    _latest_signal_ts = time.time()

    return result


@app.post("/intent/live", response_model=IntentResponse)
def intent_live(req: IntentRequest, _: None = Depends(require_auth)):
    _check_kill_switch()
    mode = "live" if TRADING_MODE == "live" else "paper"
    return _process_intent(req, mode)


@app.post("/intent/paper", response_model=IntentResponse)
def intent_paper(req: IntentRequest, _: None = Depends(require_auth)):
    return _process_intent(req, "paper")


@app.post("/kill-switch")
def kill_switch(req: KillSwitchRequest, _: None = Depends(require_auth)):
    global kill_switch_active, kill_switch_reason
    global _guardian_triggered, _guardian_trigger_reason, _guardian_trigger_ts

    kill_switch_active = req.activate
    if req.activate:
        kill_switch_reason = req.reason or "Manual activation"
        if _prometheus_available:
            kill_switch_triggers.inc()
        logger.warning("Kill switch activated: %s", kill_switch_reason)
    else:
        kill_switch_reason = None
        _guardian_triggered = False
        _guardian_trigger_reason = None
        _guardian_trigger_ts = None
        logger.info("Kill switch deactivated")

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(
                broadcast(
                    {
                        "type": "kill_switch",
                        "active": kill_switch_active,
                        "reason": kill_switch_reason,
                    }
                )
            )
    except RuntimeError:
        pass

    return {
        "kill_switch_active": kill_switch_active,
        "kill_switch_reason": kill_switch_reason,
    }


@app.post("/withdraw")
def withdraw(req: WithdrawRequest, _: None = Depends(require_auth)):
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
# Endpoints — Earnings
# ---------------------------------------------------------------------------


@app.get("/earnings/summary", dependencies=[Depends(rate_limit)])
def get_earnings_summary():
    """Aggregate realized P&L summary for the paper portfolio."""
    return earnings_get_summary()


@app.get("/earnings/history", dependencies=[Depends(rate_limit)])
def get_earnings_history(
    symbol: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Closed trade history with per-trade realized P&L, newest first."""
    return {"trades": earnings_get_history(symbol=symbol, limit=limit)}


@app.post("/earnings/reset")
def reset_earnings_ledger(_: None = Depends(require_auth)):
    """Reset the earnings ledger (paper mode utility, requires auth when key set)."""
    reset_earnings()
    return {"status": "ok", "message": "Earnings ledger cleared"}


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
                "guardian_triggered": _guardian_triggered,
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
                        "guardian_triggered": _guardian_triggered,
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
