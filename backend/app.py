"""
FastAPI backend for the Crypto Signal Bot.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Security, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

from backend.config.runtime import get_runtime_config
from backend.logic import context, rate_limit
from backend.logic.audit_store import (
    append_intent,
    append_order,
    append_risk_event,
    append_trace,
    append_withdrawal,
    get_audit,
    get_trace_by_intent_id,
    get_traces,
)
from backend.models.decision_trace import (
    DecisionTrace,
    ExecutionSnapshot,
    GuardianSnapshot,
    RiskSnapshot,
    RuleTrace,
    SignalSnapshot,
)
from backend.logic.earnings import (
    get_history as earnings_get_history,
    get_summary as earnings_get_summary,
    record_fill as earnings_record_fill,
    reset_earnings,
)
from backend.logic.exchange_adapter import ExchangeAdapter, build_adapter
from backend.logic.market_data import BasePublicMarketDataService, build_public_market_data_service
from backend.logic.startup_checks import run as run_startup_checks
from backend.logic.paper_trading import (
    PaperPortfolio,
    _parse_symbol,
    _synthetic_price,
)
from backend.logic.risk import compute_risk_score, risk_gate
from backend.logic.signals import build_signal
from backend.engine.risk_rules import RiskRuleEngine
from backend.engine.mainnet_gate import assert_not_mainnet, mainnet_status, MainnetGateError
from backend.models.risk import RiskContext
from backend.logic.simulate import StepResult, simulate_session
from backend.db.session import init_db, close_db
from backend.services.portfolio_persistence import (
    persist_portfolio,
    persist_order,
    restore_portfolio,
)
from backend.models.execution_intent import (
    ExecutionIntent,
    IntentRequest,
    IntentResponse,
    IntentStatus,
)
from backend.models_core import Features
from backend.services.guardian_bot.service import TradingScopeHaltedError, assert_scope_allowed
from backend.logic.market_state import build_market_state_result
from backend.services.reconciliation.service import (
    start_reconciliation,
    stop_reconciliation,
    get_latest_report as get_reconciliation_report,
)
from backend.services.stream_service import stream_manager, handle_stream_client
from backend.services.websocket_manager import (
    ConnectionManager,
    broadcast_ticker_loop,
    manager as ws_manager,
)

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
_env_path = os.path.join(os.path.dirname(__file__), "env", ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path)
load_dotenv()

RUNTIME_CONFIG = get_runtime_config()
TRADING_MODE = RUNTIME_CONFIG.trading_mode
NETWORK = RUNTIME_CONFIG.network
EXCHANGE = RUNTIME_CONFIG.exchange
# Use CoinGecko as the public market data source.
# Binance returns HTTP 451 (geo-blocked) on Render's servers.
# CoinGecko is free, global, no credentials required.
_mde_env = os.getenv("MARKET_DATA_PUBLIC_EXCHANGE", "coingecko").strip().lower()
MARKET_DATA_PUBLIC_EXCHANGE = _mde_env if _mde_env else "coingecko"
BACKEND_API_KEY = RUNTIME_CONFIG.backend_api_key
# Force live market data in paper mode — Binance public REST is always available.
# The PAPER_USE_LIVE_MARKET_DATA env var is honoured only if explicitly set to "false".
_env_paper_live = os.getenv("PAPER_USE_LIVE_MARKET_DATA", "true")
PAPER_USE_LIVE_MARKET_DATA: bool = _env_paper_live.strip().lower() not in {"0", "false", "no", "off"}
LIVE_MARKET_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "XRPUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT",
]
_STARTED_AT = time.time()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

# ---------------------------------------------------------------------------
# Global State Initialization
# ---------------------------------------------------------------------------
paper_portfolio = PaperPortfolio(
    balances={"USDT": RUNTIME_CONFIG.paper.starting_balance_usdt}
)
context.set_portfolio(paper_portfolio)

exchange_adapter: ExchangeAdapter = build_adapter(
    trading_mode=TRADING_MODE,
    network=NETWORK,
    portfolio=paper_portfolio,
    synthetic_price_fn=_synthetic_price,
    exchange=EXCHANGE,
)
context.adapter = exchange_adapter

risk_engine = RiskRuleEngine(
    max_position_pct=RUNTIME_CONFIG.risk.max_position_pct,
    max_daily_loss_pct=RUNTIME_CONFIG.risk.max_daily_loss_pct,
    volatility_threshold=RUNTIME_CONFIG.risk.volatility_threshold,
    max_leverage=RUNTIME_CONFIG.risk.max_leverage,
    max_slippage_pct=RUNTIME_CONFIG.risk.max_slippage_pct,
)
context.risk_engine = risk_engine

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(application):
    context.app_event_loop = asyncio.get_running_loop()

    # Initialize database and restore portfolio state
    try:
        await init_db()
        await restore_portfolio(paper_portfolio, mode=TRADING_MODE)
        # Set guardian starting NAV.
        # If the restored portfolio has open non-USDT positions, use the restored NAV
        # so the guardian tracks real drawdown from that session's high-water mark.
        # If the portfolio is cash-only (fresh start or fully liquidated), always reset
        # to the USDT balance so a stale prior-session NAV cannot trigger a false drawdown.
        restored_nav = paper_portfolio.get_total_exposure(_synthetic_price)
        usdt_only = all(asset == "USDT" for asset in paper_portfolio.balances)
        if usdt_only or restored_nav <= 0:
            # Fresh start — use current USDT balance as starting NAV
            context.guardian_starting_nav = paper_portfolio.get_balance("USDT") or 10000.0
        else:
            # Restore the real NAV so the guardian tracks from where we left off
            context.guardian_starting_nav = restored_nav
        logger.info(
            "Guardian starting NAV set to %.2f (usdt_only=%s, restored_nav=%.2f)",
            context.guardian_starting_nav, usdt_only, restored_nav,
        )
    except Exception as exc:
        logger.warning("DB init skipped (non-fatal): %s", exc)

    # Pre-warm the CoinGecko price cache so the signal service hits cache on first eval
    # This eliminates the 429 storm caused by 9 simultaneous requests at startup
    try:
        from backend.adapters.exchanges.coingecko import warm_cache
        await warm_cache()
    except Exception as exc:
        logger.warning("CoinGecko pre-warm skipped (non-fatal): %s", exc)

    if PAPER_USE_LIVE_MARKET_DATA:  # Start coingecko market data in both paper and live modes
        svc = _get_market_data_service()
        await svc.start()

    run_startup_checks(
        trading_mode=TRADING_MODE,
        network=NETWORK,
        adapter_mode=exchange_adapter.mode,
        exchange=EXCHANGE,
    )
    logger.info("Startup auth config: BACKEND_API_KEY configured=%s", bool(BACKEND_API_KEY))
    await start_reconciliation()

    # Preload ticker cache with initial prices
    _warm_ticker_cache()

    # Start background tasks: heartbeat + ticker broadcast
    heartbeat_task = asyncio.create_task(ws_manager.heartbeat_loop())
    ticker_task = asyncio.create_task(
        broadcast_ticker_loop(
            get_live_price=_get_live_price_for_ticker,
            interval=3.0,
        )
    )
    logger.info("Background tasks started: heartbeat + ticker broadcast")

    # ── Background services (must start after app is fully initialised) ──
    try:
        from backend.services.signal_service.service import start_signal_service as _start_ss
        await _start_ss(app)
    except Exception as _exc:
        logger.warning("Signal service start skipped: %s", _exc)
    try:
        from backend.services.portfolio.service import start_portfolio_service as _start_ps
        await _start_ps(app)
    except Exception as _exc:
        logger.warning("Portfolio service start skipped: %s", _exc)
    try:
        from backend.services.guardian_bot.monitor import start_guardian_monitor as _start_gm
        await _start_gm(app)
    except Exception as _exc:
        logger.warning("Guardian monitor start skipped: %s", _exc)
    try:
        from backend.services.monitoring.service import start_monitoring_service as _start_mon
        await _start_mon(app)
    except Exception as _exc:
        logger.warning("Monitoring service start skipped: %s", _exc)
    try:
        from backend.services.signal_executor.service import start_signal_executor as _start_exec
        await _start_exec(app)
    except Exception as _exc:
        logger.warning("Signal executor start skipped: %s", _exc)
    try:
        from backend.services.surge_scanner.service import start_surge_scanner as _start_surge
        import asyncio as _asyncio
        _asyncio.create_task(_start_surge(), name="surge_scanner_boot")
    except Exception as _exc:
        logger.warning("Surge scanner start skipped: %s", _exc)
    logger.info("All background services registered.")
    try:
        from backend.services.market_data.ingestion import pipeline as _ingestion_pipeline
        await _ingestion_pipeline.start()
        logger.info("Ingestion pipeline started (%d symbols).", len(_ingestion_pipeline._active))
    except Exception as _exc:
        logger.warning("Ingestion pipeline start skipped (non-fatal): %s", _exc)

    try:
        yield
    finally:
        heartbeat_task.cancel()
        ticker_task.cancel()
        # Persist portfolio before shutdown
        try:
            await persist_portfolio(paper_portfolio, mode=TRADING_MODE)
        except Exception:
            logger.warning("Portfolio persist on shutdown failed (non-fatal).")
        await stop_reconciliation()
        try:
            from backend.services.market_data.ingestion import pipeline as _ingestion_pipeline
            await _ingestion_pipeline.stop()
        except Exception:
            pass
        if context.market_data_service is not None:
            await context.market_data_service.stop()
        try:
            await close_db()
        except Exception:
            pass

app = FastAPI(title="Crypto Signal Bot — Trading Backend", version="2.3.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Basic Routes (Defined FIRST to avoid 404s)
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    """Root endpoint for health checks and discovery."""
    return {
        "name": "Crypto Signal Bot API",
        "version": "2.3.0",
        "status": "online",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/health")
@app.get("/healthz")
@app.get("/api/health")
async def health():
    """Dependency-light hosted liveness check.

    Render health probes should only prove that the ASGI application is alive,
    imported, and bound to the expected port. Deeper runtime diagnostics that can
    touch market data, portfolio state, audit stores, or exchange adapters belong
    on `/config`, `/balance`, and `/guardian/status` so a non-critical runtime
    issue cannot cause Render to mark the whole service unhealthy.
    """
    try:
        market_data = _get_market_data_status()
    except Exception:
        market_data = {"market_data_mode": "unknown", "connected": False, "source": "unavailable"}
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "asgi",
        "mode": TRADING_MODE,
        "network": NETWORK,
        "adapter": getattr(exchange_adapter, "mode", "unknown"),
        "kill_switch_active": context.kill_switch_active,
        "halted": context.kill_switch_active,
        "guardian_triggered": context.guardian_triggered,
        "market_data_mode": market_data["market_data_mode"],
        "market_data_connected": market_data["connected"],
        "market_data_source": market_data.get("source", "synthetic"),
        "uptime_seconds": round(time.time() - _STARTED_AT, 3),
    }

@app.get("/ping")
async def ping():
    """Lightweight keepalive endpoint — responds under 50ms."""
    return {"ok": True}

@app.get("/ready")
async def ready():
    """Readiness diagnostics that avoid exposing secret values."""
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "asgi",
        "backend_api_key_configured": bool(BACKEND_API_KEY),
        "cors_origins_configured": bool(ALLOWED_ORIGINS),
        "cors_origin_count": len(ALLOWED_ORIGINS),
        "mode": TRADING_MODE,
        "network": NETWORK,
    }

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    ",".join(RUNTIME_CONFIG.server.cors_origins),
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trust X-Forwarded-For from reverse proxies (nginx, Render, Railway, Fly.io)
# This ensures rate limiting uses real client IPs, not proxy IPs.
try:
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware  # type: ignore
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
except ImportError:
    pass  # uvicorn not installed in this env — proxy headers handled at infra level

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

def require_auth(api_key: Optional[str] = Security(_api_key_header)):
    if not BACKEND_API_KEY:
        return
    if api_key != BACKEND_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

# Phase 4 — Include public and compatibility routers
from backend.routes.compatibility import compatibility_router
from backend.routes.integrations import integrations_router
from backend.routes.kill_switch import router as kill_switch_router
from backend.routes.waitlist import waitlist_router
from backend.routes.signals_v1 import router as signals_v1_router
from backend.services.signal_service.service import start_signal_service
from backend.routes.portfolio_v1 import router as portfolio_v1_router
from backend.services.portfolio.service import start_portfolio_service
from backend.routes.risk_v1 import router as risk_v1_router
from backend.routes.console_v1 import router as console_v1_router
from backend.routes.monitor_v1 import router as monitor_v1_router
from backend.routes.decisions_v1 import router as decisions_v1_router
from backend.replay.routes import router as replay_v1_router
from backend.backtest.routes import router as backtest_v1_router
from backend.services.guardian_bot.monitor import start_guardian_monitor

# Track already registered paths to avoid duplicates
# NOTE: price_router excluded — app.py defines /price and /exchange/status
# with synthetic fallback; the routes/price.py router requires a live
# MarketDataService and would shadow the synthetic-safe defaults.
_registered_paths = {getattr(route, "path", None) for route in app.routes}
for _router in (compatibility_router, integrations_router, waitlist_router, kill_switch_router, signals_v1_router, portfolio_v1_router, risk_v1_router, console_v1_router, monitor_v1_router, decisions_v1_router, replay_v1_router, backtest_v1_router):
    _router_paths = {getattr(route, "path", None) for route in _router.routes}
    if not _router_paths.issubset(_registered_paths):
        app.include_router(_router)
        _registered_paths.update(_router_paths)

# ---------------------------------------------------------------------------
# Guardian Logic
# ---------------------------------------------------------------------------
_GUARDIAN_MAX_API_ERRORS = RUNTIME_CONFIG.guardian.max_api_errors
_GUARDIAN_MAX_FAILED_ORDERS = RUNTIME_CONFIG.guardian.max_failed_orders
_GUARDIAN_MAX_DRAWDOWN_PCT = RUNTIME_CONFIG.guardian.max_drawdown_pct

def _guardian_evaluate() -> Optional[str]:
    if context.api_error_count >= _GUARDIAN_MAX_API_ERRORS:
        return f"API error threshold reached ({context.api_error_count} errors)"
    if context.failed_order_count >= _GUARDIAN_MAX_FAILED_ORDERS:
        return f"Failed order threshold reached ({context.failed_order_count} failures)"
    current_nav = paper_portfolio.get_total_exposure(_synthetic_price)
    if context.guardian_starting_nav > 0:
        context.guardian_drawdown_pct = max(
            0.0, (context.guardian_starting_nav - current_nav) / context.guardian_starting_nav
        )
        if context.guardian_drawdown_pct >= _GUARDIAN_MAX_DRAWDOWN_PCT:
            return (
                f"Drawdown limit breached ({context.guardian_drawdown_pct*100:.1f}% >= "
                f"{_GUARDIAN_MAX_DRAWDOWN_PCT*100:.1f}%)"
            )
    return None

async def _guardian_check_and_broadcast():
    if context.kill_switch_active:
        return
    reason = _guardian_evaluate()
    if reason:
        context.kill_switch_active = True
        context.kill_switch_reason = f"Guardian: {reason}"
        context.guardian_triggered = True
        context.guardian_trigger_reason = reason
        context.guardian_trigger_ts = time.time()
        logger.warning("Guardian triggered kill switch: %s", reason)
        await context.broadcast(
            {
                "type": "guardian_alert",
                "reason": reason,
                "kill_switch_active": True,
                "timestamp": context.guardian_trigger_ts,
            }
        )

# ---------------------------------------------------------------------------
# Market Data Helpers
# ---------------------------------------------------------------------------
def _get_market_data_service() -> BasePublicMarketDataService:
    if context.market_data_service is None:
        context.market_data_service = build_public_market_data_service(
            MARKET_DATA_PUBLIC_EXCHANGE,
            symbols=LIVE_MARKET_SYMBOLS,
            on_market_update=_handle_market_data_update,
            on_status_change=_handle_market_data_status_change,
        )
    return context.market_data_service

async def _handle_market_data_update(snapshot: Dict[str, Any]) -> None:
    result = build_market_state_result(
        symbol=snapshot["symbol"],
        price=float(snapshot["price"]),
        change24h=float(snapshot.get("change24h", 0.0)),
        volume24h=float(snapshot.get("volume24h", 0.0)),
        market_cap=float(snapshot.get("marketCap", 0.0)),
        market_data_source=str(snapshot.get("source", f"{MARKET_DATA_PUBLIC_EXCHANGE}-public")),
    )
    symbol = snapshot["symbol"].upper()
    timestamp = float(snapshot.get("timestamp", time.time()))
    context.latest_signal_by_symbol[symbol] = result
    context.latest_signal_ts_by_symbol[symbol] = timestamp

    await context.broadcast(
        {
            "type": "market_update",
            "symbol": snapshot["symbol"],
            "price": snapshot["price"],
            "change24h": snapshot.get("change24h", 0.0),
            "signal": result["signal"],
            "risk": result["risk"],
            "timestamp": snapshot.get("timestamp", time.time()),
            "source": snapshot.get("source", f"{MARKET_DATA_PUBLIC_EXCHANGE}-public"),
            "exchange": snapshot.get("exchange", MARKET_DATA_PUBLIC_EXCHANGE),
        }
    )

async def _handle_market_data_status_change(status: Dict[str, Any]) -> None:
    await context.broadcast({"type": "exchange_status", **status})

# ---------------------------------------------------------------------------
# Ticker helpers (warm cache + live price resolver for broadcast)
# ---------------------------------------------------------------------------
_ticker_cache: Dict[str, float] = {}

def _warm_ticker_cache() -> None:
    """Preload ticker cache with synthetic prices so dashboard never shows blanks."""
    from backend.services.websocket_manager import TICKER_SYMBOLS, _BASE_PRICES
    for symbol in TICKER_SYMBOLS:
        try:
            _ticker_cache[symbol] = _synthetic_price(symbol)
        except Exception:
            _ticker_cache[symbol] = _BASE_PRICES.get(symbol, 0.0)
    logger.info("Ticker cache warmed: %s", list(_ticker_cache.keys()))

def _get_live_price_for_ticker(symbol: str) -> Optional[float]:
    """Try to get a live/cached price for the ticker broadcast.

    Resolution order:
    1. Live market data service snapshot (Binance public feed)
    2. Signal cache from prior market data updates
    3. Synthetic price simulation fallback
    """
    # Check live market data service first (most current)
    if PAPER_USE_LIVE_MARKET_DATA and context.market_data_service is not None:
        snap = context.market_data_service.get_snapshot(symbol)
        if snap and "price" in snap:
            return float(snap["price"])
    # Check context signal cache
    cached = context.latest_signal_by_symbol.get(symbol)
    if cached and "price" in cached:
        return float(cached["price"])
    # Fall back to synthetic price
    try:
        return _synthetic_price(symbol)
    except Exception:
        return None

def _get_market_data_status() -> Dict[str, Any]:
    if TRADING_MODE == "paper" and PAPER_USE_LIVE_MARKET_DATA:
        return _get_market_data_service().get_status()

    # Mock status for synthetic/live modes
    mode_label = "synthetic_paper"
    if TRADING_MODE == "live":
        mode_label = "execution_only" if exchange_adapter.mode != "paper" else "synthetic_paper"

    return {
        "exchange": MARKET_DATA_PUBLIC_EXCHANGE if TRADING_MODE == "live" else None,
        "market_data_mode": mode_label,
        "connected": False,
        "connection_state": "disabled",
        "fallback_active": False,
        "last_update_ts": None,
        "last_error": None,
        "stale": True,
        "symbols": [],
        "source": "synthetic",
    }

# ---------------------------------------------------------------------------
# Models & Exceptions
# ---------------------------------------------------------------------------
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

class ExchangeAPIError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        self.message = message
        self.status_code = status_code

@app.exception_handler(ExchangeAPIError)
async def exchange_error_handler(request, exc: ExchangeAPIError):
    context.api_error_count += 1
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "exchange_error", "message": exc.message},
    )

# ---------------------------------------------------------------------------
# Decision Trace Helpers
# ---------------------------------------------------------------------------
def _capture_guardian_snapshot() -> GuardianSnapshot:
    return GuardianSnapshot(
        kill_switch_active=context.kill_switch_active,
        kill_switch_reason=context.kill_switch_reason,
        guardian_triggered=context.guardian_triggered,
        drawdown_pct=context.guardian_drawdown_pct,
        api_error_count=context.api_error_count,
        failed_order_count=context.failed_order_count,
    )

def _capture_signal_snapshot(symbol: str) -> SignalSnapshot:
    cached = context.latest_signal_by_symbol.get(symbol.upper())
    if not cached or "signal" not in cached:
        return SignalSnapshot()
    sig = cached["signal"]
    return SignalSnapshot(
        regime=sig.get("regime", "UNKNOWN"),
        direction=sig.get("direction", "NEUTRAL"),
        confidence=sig.get("confidence", 0.0) / 100.0 if sig.get("confidence", 0) > 1 else sig.get("confidence", 0.0),
        horizon_minutes=sig.get("horizon", 0),
    )

# ---------------------------------------------------------------------------
# Intent Processing
# ---------------------------------------------------------------------------
def _process_intent(req: IntentRequest, mode: str) -> IntentResponse:
    intent = ExecutionIntent(
        symbol=req.symbol.upper(),
        side=req.side,
        order_type=req.order_type,
        quantity=req.quantity,
        price=req.price,
        time_in_force=req.time_in_force,
        mode=mode,
        strategy_id=req.strategy_id,
        venue_id=req.venue_id or EXCHANGE,
    )

    # Initialize decision trace
    trace = DecisionTrace(
        intent_id=intent.id,
        symbol=intent.symbol,
        side=intent.side.value,
        quantity=intent.quantity,
        mode=mode,
        signal=_capture_signal_snapshot(intent.symbol),
        guardian=_capture_guardian_snapshot(),
    )

    # Populate price up-front so even early-rejected traces (mainnet gate,
    # guardian scope) carry the price context that downstream debugging needs.
    try:
        trace.price = req.price or _synthetic_price(intent.symbol)
    except Exception:
        trace.price = req.price or 0.0

    def _finalize_trace():
        trace.execution.status = intent.status.value
        trace.execution.fill_price = intent.fill_price
        trace.execution.fill_quantity = intent.fill_quantity
        trace.execution.adapter = exchange_adapter.mode
        trace.execution.notes = intent.notes
        if intent.fill_price and trace.price and trace.price > 0:
            trace.execution.slippage_pct = abs(intent.fill_price - trace.price) / trace.price
        try:
            append_trace(trace.to_dict())
        except Exception as exc:
            logger.warning("append_trace failed for intent %s: %s", intent.id, exc)

    try:
        return _process_intent_inner(req, mode, intent, trace)
    except Exception as exc:
        # CLAUDE.md: every decision must emit a structured trace. Make sure an
        # unhandled exception in the pipeline still produces an audit record.
        logger.exception("Unhandled error in _process_intent for %s: %s", intent.id, exc)
        if intent.status not in (IntentStatus.FILLED, IntentStatus.RISK_REJECTED):
            intent.status = IntentStatus.FAILED
        if not intent.notes:
            intent.notes = f"unhandled_error: {exc}"
        trace.risk.rejection_reasons.append(f"unhandled_error: {exc}")
        raise
    finally:
        _finalize_trace()


def _process_intent_inner(
    req: IntentRequest,
    mode: str,
    intent: ExecutionIntent,
    trace: DecisionTrace,
) -> IntentResponse:
    # Mainnet gate: block live mainnet execution unless explicitly allowed
    try:
        assert_not_mainnet(NETWORK, mode)
    except MainnetGateError as exc:
        intent.status = IntentStatus.RISK_REJECTED
        intent.notes = str(exc)
        trace.risk.rejection_reasons.append(f"mainnet_gate: {exc}")
        append_risk_event({"intent_id": intent.id, "reason": intent.notes, "source": "mainnet_gate"})
        intent_data = intent.model_dump()
        append_intent(intent_data)
        context.schedule_background(persist_order, intent_data, TRADING_MODE)
        return IntentResponse(id=intent.id, status=intent.status.value, notes=intent.notes)

    try:
        assert_scope_allowed(strategy_id=intent.strategy_id, venue_id=intent.venue_id)
    except TradingScopeHaltedError as exc:
        intent.status = IntentStatus.RISK_REJECTED
        intent.notes = str(exc)
        trace.risk.rejection_reasons.append(f"guardian_scope: {exc}")
        append_risk_event({"intent_id": intent.id, "reason": intent.notes, "source": "guardian_scope"})
        intent_data = intent.model_dump()
        append_intent(intent_data)
        context.schedule_background(persist_order, intent_data, TRADING_MODE)
        return IntentResponse(id=intent.id, status=intent.status.value, notes=intent.notes)

    current_price = trace.price or req.price or _synthetic_price(intent.symbol)
    trace.price = current_price
    total_equity = paper_portfolio.get_total_exposure(_synthetic_price)

    # Symbol-specific position value (not total portfolio)
    base_asset, _quote = _parse_symbol(intent.symbol)
    symbol_position_value = paper_portfolio.get_balance(base_asset) * current_price

    # Non-cash exposure: sum of all non-USDT holdings at current prices
    non_cash_exposure = 0.0
    for asset, amount in paper_portfolio.balances.items():
        if asset not in ("USDT", "USDC", "BUSD"):
            try:
                non_cash_exposure += amount * _synthetic_price(f"{asset}USDT")
            except Exception:
                pass

    risk_ctx = RiskContext(
        symbol=intent.symbol,
        side=intent.side.value,
        quantity=intent.quantity,
        price=current_price,
        current_position_value=symbol_position_value,
        current_total_exposure=non_cash_exposure,
        daily_pnl=context.guardian_drawdown_pct * context.guardian_starting_nav * -1.0,
        account_balance=total_equity,
        volatility_24h=0.02,
    )
    engine_result = risk_engine.evaluate(risk_ctx)

    # Populate trace risk snapshot
    trace.risk.approved = engine_result.approved
    trace.risk.combined_size_multiplier = engine_result.size_multiplier
    trace.risk.rules_evaluated = [
        RuleTrace(
            rule_name=r.rule_name,
            passed=r.passed,
            reason=r.reason,
            size_multiplier=r.size_multiplier,
        )
        for r in engine_result.rule_results
    ]

    if not engine_result.approved:
        intent.status = IntentStatus.RISK_REJECTED
        intent.notes = engine_result.reason
        trace.risk.rejection_reasons = [
            r.reason for r in engine_result.rule_results if not r.passed
        ]
        append_risk_event({"intent_id": intent.id, "risk_engine": engine_result.to_dict(), "reason": intent.notes})
        intent_data = intent.model_dump()
        append_intent(intent_data)
        context.schedule_background(persist_order, intent_data, TRADING_MODE)
        return IntentResponse(id=intent.id, status=intent.status.value, notes=intent.notes)

    if engine_result.size_multiplier < 1.0:
        intent.quantity = round(intent.quantity * engine_result.size_multiplier, 8)
    trace.risk.adjusted_quantity = intent.quantity

    intent.status = IntentStatus.RISK_APPROVED

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
        context.failed_order_count += 1

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

    # Persist portfolio state and order to database
    context.schedule_background(persist_portfolio, paper_portfolio, TRADING_MODE)
    context.schedule_background(persist_order, intent_data, TRADING_MODE)

    context.schedule_background(
        context.broadcast,
        {
            "type": "order_update",
            "intent_id": intent.id,
            "status": intent.status.value,
            "symbol": intent.symbol,
            "side": intent.side.value,
            "fill_price": intent.fill_price,
        },
    )
    context.schedule_background(_guardian_check_and_broadcast)
    return IntentResponse(id=intent.id, status=intent.status.value, notes=intent.notes)

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/config", dependencies=[Depends(rate_limit.rate_limit)])
def get_config():
    return {
        "trading_mode": TRADING_MODE,
        "network": NETWORK,
        "adapter": exchange_adapter.mode,
        "exchange": EXCHANGE,
        "adapter_exchange": exchange_adapter.exchange,
        "market_data_public_exchange": MARKET_DATA_PUBLIC_EXCHANGE,
        "paper_use_live_market_data": PAPER_USE_LIVE_MARKET_DATA,
        "config_path": RUNTIME_CONFIG.config_path,
        "cors_origins": ALLOWED_ORIGINS,
        "kill_switch_active": context.kill_switch_active,
        "auth_enabled": bool(BACKEND_API_KEY),
        "rate_limit_rpm": RUNTIME_CONFIG.rate_limit_rpm,
        "risk_engine": {
            "rules": [r.name for r in risk_engine.rules],
            "max_position_pct": RUNTIME_CONFIG.risk.max_position_pct,
            "max_daily_loss_pct": RUNTIME_CONFIG.risk.max_daily_loss_pct,
            "volatility_threshold": RUNTIME_CONFIG.risk.volatility_threshold,
            "max_leverage": RUNTIME_CONFIG.risk.max_leverage,
            "max_slippage_pct": RUNTIME_CONFIG.risk.max_slippage_pct,
        },
    }

@app.get("/mainnet-gate/status", dependencies=[Depends(rate_limit.rate_limit)])
def get_mainnet_gate_status():
    return mainnet_status()

@app.get("/exchange/status", dependencies=[Depends(rate_limit.rate_limit)])
def get_exchange_status():
    market_data = _get_market_data_status()
    execution_mode = exchange_adapter.mode
    return {
        "trading_mode": TRADING_MODE,
        "execution_mode": execution_mode,
        "market_data_mode": market_data["market_data_mode"],
        "paper_use_live_market_data": PAPER_USE_LIVE_MARKET_DATA,
        "exchange": market_data.get("exchange"),
        "connected": market_data.get("connected", False),
        "connection_state": market_data.get("connection_state", "disabled"),
        "fallback_active": market_data.get("fallback_active", False),
        "stale": market_data.get("stale", True),
        "symbols": market_data.get("symbols", []),
        "source": market_data.get("source", "synthetic"),
        "last_update_ts": market_data.get("last_update_ts"),
        "last_error": market_data.get("last_error"),
    }


@app.get("/exchange/supported")
def get_exchange_supported():
    """Return support matrix for all exchanges. Acceptance checklist item 14."""
    return {
        "supported": [
            {
                "id": "binance",
                "name": "Binance",
                "public_market_data": True,
                "ohlcv_source": "binance_us_ohlcv",
                "paper_execution": False,
                "testnet_auth_supported": False,
                "live_execution_enabled": False,
                "adapter_file": "backend/adapters/exchanges/binance.py",
            },
            {
                "id": "bitget",
                "name": "Bitget",
                "public_market_data": True,
                "ohlcv_source": "bitget_rest",
                "paper_execution": False,
                "testnet_auth_supported": False,
                "live_execution_enabled": False,
                "adapter_file": "backend/adapters/exchanges/bitget.py",
            },
            {
                "id": "btcc",
                "name": "BTCC",
                "public_market_data": True,
                "ohlcv_source": "btcc_rest",
                "paper_execution": False,
                "testnet_auth_supported": False,
                "live_execution_enabled": False,
                "adapter_file": "backend/adapters/exchanges/btcc.py",
            },
            {
                "id": "coinbase",
                "name": "Coinbase",
                "public_market_data": True,
                "ohlcv_source": "coinbase_rest",
                "paper_execution": False,
                "sandbox_auth_supported": False,
                "live_execution_enabled": False,
                "adapter_file": "backend/adapters/exchanges/coinbase.py",
            },
            {
                "id": "coingecko",
                "name": "CoinGecko",
                "public_market_data": True,
                "ohlcv_source": "coingecko_rest",
                "paper_execution": False,
                "live_execution_enabled": False,
                "adapter_file": "backend/adapters/exchanges/coingecko.py",
                "note": "Primary market data source (geo-restriction fallback)",
            },
        ],
        "execution_adapter": "paper",
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "safe_mode": True,
        "trading_mode": TRADING_MODE,
    }


@app.get("/market/feed/status")
def get_market_feed_status():
    """Return current market data feed status."""
    mds = _get_market_data_status()
    symbols = mds.get("symbols", [])
    last_ts = mds.get("last_update_ts")
    stale = mds.get("stale", True)
    connected = mds.get("connected", False)
    return {
        "source": mds.get("source", "synthetic"),
        "exchange": mds.get("exchange", MARKET_DATA_PUBLIC_EXCHANGE),
        "symbol_count": len(symbols),
        "symbols": symbols,
        "connected": connected,
        "stale": stale,
        "last_tick_at": last_ts,
        "latency_ms": None,
        "fallback_active": mds.get("fallback_active", False),
        "safe_mode_reason": None if connected else "market_data_unavailable",
        "market_data_mode": mds.get("market_data_mode", "synthetic"),
    }


@app.post("/exchange/test-connection")
async def test_exchange_connection(exchange: str = "coinbase"):
    """
    Diagnostic connectivity test. Does NOT place real orders.
    Checks public API reachability for the specified exchange.
    Supports: binance, bitget, btcc, coinbase, coingecko.
    """
    supported = {"binance", "bitget", "btcc", "coinbase", "coingecko"}
    if exchange not in supported:
        return {"mode": "safe", "reason": f"unsupported_exchange: {exchange}", "supported": list(supported)}

    result = {
        "exchange": exchange,
        "test_type": "public_market_data",
        "live_orders_attempted": False,
        "secrets_exposed": False,
        "mode": "diagnostic",
    }

    try:
        import httpx
        urls = {
            "binance": "https://api.binance.us/api/v3/ping",
            "bitget": "https://api.bitget.com/api/v2/public/time",
            "btcc": "https://api.btcc.com/api/v1/info",
            "coinbase": "https://api.coinbase.com/api/v3/brokerage/products/BTC-USDT",
            "coingecko": "https://api.coingecko.com/api/v3/ping",
        }
        url = urls[exchange]
        import time as _time
        t0 = _time.time()
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
        latency_ms = round((_time.time() - t0) * 1000, 1)
        result["connected"] = r.status_code in (200, 201)
        result["http_status"] = r.status_code
        result["latency_ms"] = latency_ms
        result["error"] = None
    except Exception as exc:
        result["connected"] = False
        result["latency_ms"] = None
        result["error"] = str(exc)

    return result


@app.get("/version")
def get_version():
    """Return application version and runtime info."""
    import sys
    import os
    return {
        "version": "1.0.0",
        "mode": TRADING_MODE,
        "network": NETWORK,
        "python": sys.version.split()[0],
        "safe_mode": True,
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "paper_only": True,
    }


@app.get("/runtime/status")
def get_runtime_status():
    """Return backend runtime state: uptime, safe mode, exchange, WS clients."""
    import time as _time
    mds = _get_market_data_status()
    from backend.services.guardian_bot import service as _gsvc
    ws_clients = len(getattr(ws_manager, "_connections", []))
    return {
        "mode": TRADING_MODE,
        "network": NETWORK,
        "safe_mode": True,
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "selected_exchange": MARKET_DATA_PUBLIC_EXCHANGE,
        "feed_connected": mds.get("connected", False),
        "feed_stale": mds.get("stale", True),
        "feed_source": mds.get("source", "synthetic"),
        "websocket_clients": ws_clients,
        "guardian_triggered": _gsvc._triggered,
        "kill_switch_active": _gsvc._kill_switch_active,
        "drawdown_pct": _gsvc._drawdown_pct,
    }


@app.get("/config/snapshot")
def get_config_snapshot():
    """Return current config without secrets. Includes config hash."""
    import hashlib, json as _json
    cfg = get_runtime_config()
    snapshot = {
        "trading_mode": TRADING_MODE,
        "network": NETWORK,
        "market_data_source": MARKET_DATA_PUBLIC_EXCHANGE,
        "paper_use_live_market_data": PAPER_USE_LIVE_MARKET_DATA,
        "live_execution_enabled": exchange_adapter.mode == "mainnet",
        "withdrawals_enabled": False,
        "safe_mode": exchange_adapter.mode != "mainnet",
        "risk": {
            "max_position_pct": cfg.risk.max_position_pct if hasattr(cfg, "risk") else None,
            "max_daily_loss_pct": cfg.risk.max_daily_loss_pct if hasattr(cfg, "risk") else None,
        },
    }
    snapshot_str = _json.dumps(snapshot, sort_keys=True)
    snapshot["config_hash"] = hashlib.sha256(snapshot_str.encode()).hexdigest()[:16]
    return snapshot


@app.get("/balance", dependencies=[Depends(rate_limit.rate_limit)])
def get_balance():
    return {"balances": paper_portfolio.get_all_balances(), "positions": paper_portfolio.get_positions()}

@app.get("/positions", dependencies=[Depends(rate_limit.rate_limit)])
def get_positions_api():
    return {"positions": paper_portfolio.get_positions()}

@app.get("/orders", dependencies=[Depends(rate_limit.rate_limit)])
def get_orders_api(symbol: Optional[str] = Query(None)):
    orders = paper_portfolio.open_orders
    if symbol:
        orders = [o for o in orders if o.symbol == symbol.upper()]
    return {
        "orders": [
            {
                "id": o.id, "symbol": o.symbol, "side": o.side.value,
                "order_type": o.order_type.value, "quantity": o.quantity,
                "price": o.price, "status": o.status.value, "created_at": o.created_at,
            } for o in orders
        ]
    }

@app.get("/price", dependencies=[Depends(rate_limit.rate_limit)])
def get_price_api(symbol: str = Query("BTCUSDT")):
    normalized_symbol = symbol.upper()
    if TRADING_MODE == "paper" and PAPER_USE_LIVE_MARKET_DATA:
        svc = _get_market_data_service()
        snap = svc.get_snapshot(normalized_symbol)
        if snap:
            return {
                "symbol": normalized_symbol,
                "price": round(float(snap["price"]), 8),
                "change24h": float(snap.get("change24h", 0.0)),
                "volume24h": float(snap.get("volume24h", 0.0)),
                "marketCap": float(snap.get("marketCap", 0.0)),
                "timestamp": snap["timestamp"],
                "source": snap.get("source", f"{MARKET_DATA_PUBLIC_EXCHANGE}-public"),
                "exchange": snap.get("exchange", MARKET_DATA_PUBLIC_EXCHANGE),
                "market_data_mode": "live_public_paper",
            }
        status = svc.get_status()
        tracked = status.get("symbols", [])
        if normalized_symbol not in [s.upper() for s in tracked]:
            return JSONResponse(
                status_code=404,
                content={"error": "symbol_not_tracked", "symbol": normalized_symbol},
            )
        return JSONResponse(
            status_code=503,
            content={"error": "market_data_unavailable", "symbol": normalized_symbol},
        )

    if TRADING_MODE == "live" and exchange_adapter.mode != "paper":
        try:
            price = exchange_adapter.get_price(normalized_symbol)
            return {
                "symbol": normalized_symbol, "price": round(float(price), 8),
                "change24h": 0.0, "volume24h": 0.0, "marketCap": 0.0,
                "timestamp": time.time(), "source": "execution_adapter",
                "exchange": exchange_adapter.exchange, "market_data_mode": "execution_only",
            }
        except Exception as exc:
            raise ExchangeAPIError(f"Live price fetch failed: {exc}")

    if TRADING_MODE == "live" and exchange_adapter.mode == "paper":
        return JSONResponse(
            status_code=503,
            content={"error": "execution_unavailable", "symbol": normalized_symbol},
        )

    price = _synthetic_price(normalized_symbol)
    return {
        "symbol": normalized_symbol, "price": round(price, 8),
        "change24h": 0.0, "volume24h": 0.0, "marketCap": 0.0,
        "timestamp": time.time(), "source": "synthetic",
        "exchange": None, "market_data_mode": "synthetic_paper",
    }

@app.get("/audit", dependencies=[Depends(rate_limit.rate_limit)])
def get_audit_trail_api():
    return get_audit()

@app.get("/traces", dependencies=[Depends(rate_limit.rate_limit)])
def get_traces_api(
    symbol: Optional[str] = Query(None, description="Filter by symbol"),
    status: Optional[str] = Query(None, description="Filter by execution status"),
    limit: int = Query(50, ge=1, le=500, description="Max traces to return"),
):
    return get_traces(symbol=symbol, status=status, limit=limit)

@app.get("/trace/{intent_id}", dependencies=[Depends(rate_limit.rate_limit)])
def get_trace_by_intent(intent_id: str):
    trace = get_trace_by_intent_id(intent_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace

@app.get("/metrics")
def get_metrics_api():
    try:
        from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
        return JSONResponse(content=generate_latest().decode("utf-8"), media_type=CONTENT_TYPE_LATEST)
    except ImportError:
        return {"message": "prometheus_client not installed"}

@app.get("/signal/latest", dependencies=[Depends(rate_limit.rate_limit)])
def get_signal_latest_api(symbol: Optional[str] = Query(None)):
    from backend.logic.market_state import get_signal_latest
    return get_signal_latest(symbol)


@app.get("/exchange/circuit-breakers", dependencies=[Depends(rate_limit.rate_limit)])
def get_circuit_breaker_statuses():
    """Return circuit breaker state for all registered exchange adapters."""
    try:
        from backend.services.exchange_retry import get_all_circuit_breaker_statuses
        return {"circuit_breakers": get_all_circuit_breaker_statuses()}
    except Exception as exc:
        return {"circuit_breakers": [], "error": str(exc)}

@app.get("/reconciliation/status", dependencies=[Depends(rate_limit.rate_limit)])
async def reconciliation_status_api():
    report = await get_reconciliation_report()
    if report is None:
        return {"status": "no_report", "message": "Reconciliation has not run yet."}
    return {"status": "ok", "report": report}

@app.get("/reconciliation/exchange", dependencies=[Depends(rate_limit.rate_limit)])
def exchange_reconciliation_api():
    from backend.services.exchange_reconciler import reconcile_against_exchange
    result = reconcile_against_exchange(
        adapter=exchange_adapter,
        local_balances=dict(paper_portfolio.balances),
    )
    return result.to_dict()

@app.get("/exchange/validate", dependencies=[Depends(rate_limit.rate_limit)])
def exchange_validation_api():
    from backend.services.testnet_validator import validate_exchange_connectivity
    result = validate_exchange_connectivity(exchange_adapter)
    return result.to_dict()

@app.post("/market-state")
def market_state_api(req: MarketStateRequest, _: None = Depends(require_auth)):
    result = build_market_state_result(
        symbol=req.symbol, price=req.price, change24h=req.change24h,
        volume24h=req.volume24h, market_cap=req.marketCap,
        risk_tolerance=req.riskTolerance, spread_stress_threshold=req.spreadStressThreshold,
        volatility_sensitivity=req.volatilitySensitivity,
        position_size_fraction=req.positionSizeFraction,
        market_data_source="manual",
    )
    normalized_symbol = req.symbol.upper()
    timestamp = time.time()
    context.latest_signal_by_symbol[normalized_symbol] = result
    context.latest_signal_ts_by_symbol[normalized_symbol] = timestamp
    return result

@app.post("/intent/live", response_model=IntentResponse)
def intent_live_api(req: IntentRequest, _: None = Depends(require_auth)):
    # Live execution is hard-disabled in app.py for safety as per ARCHITECTURE_AUDIT.md
    # and the project requirements. Use /intent/paper for trading simulations.
    raise HTTPException(
        status_code=403,
        detail={
            "mode": "safe",
            "reason": "live_execution_disabled",
            "message": "Live execution is hard-disabled for safety. Use /intent/paper for simulations."
        }
    )

@app.post("/intent/paper", response_model=IntentResponse)
def intent_paper_api(req: IntentRequest, _: None = Depends(require_auth)):
    return _process_intent(req, "paper")

@app.post("/withdraw")
def withdraw_api(req: WithdrawRequest, _: None = Depends(require_auth)):
    # Withdrawals are explicitly disabled in paper/safe mode.
    raise HTTPException(
        status_code=403,
        detail={"mode": "safe", "reason": "withdrawals_disabled", "message": "Withdrawals are disabled. This is a paper-only simulator."}
    )

@app.get("/earnings/summary", dependencies=[Depends(rate_limit.rate_limit)])
def get_earnings_summary_api():
    return earnings_get_summary()

@app.get("/earnings/history", dependencies=[Depends(rate_limit.rate_limit)])
def get_earnings_history_api(symbol: Optional[str] = Query(None), limit: int = Query(100, ge=1, le=500)):
    return {"trades": earnings_get_history(symbol=symbol, limit=limit)}

@app.post("/earnings/reset")
def reset_earnings_ledger_api(_: None = Depends(require_auth)):
    reset_earnings()
    return {"status": "ok", "message": "Earnings ledger cleared"}

@app.websocket("/stream")
async def stream_endpoint(ws: WebSocket):
    """
    Canonical typed WebSocket stream endpoint.

    Publishes: ticker | signal | portfolio | guardian | heartbeat events.
    Client can send: { type: "ping" } or { type: "subscribe", symbols: [...] }

    See backend/services/stream_service.py for full event schema.
    """
    await handle_stream_client(ws)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """Primary WebSocket endpoint — persistent connection with ticker + status."""
    await ws_manager.connect(ws)
    # Also register in context for legacy broadcast() calls
    context.ws_clients.add(ws)
    try:
        # Send initial health snapshot
        market_data = _get_market_data_status()
        await ws.send_json({
            "type": "health",
            "kill_switch_active": context.kill_switch_active,
            "mode": TRADING_MODE,
            "api_error_count": context.api_error_count,
            "guardian_triggered": context.guardian_triggered,
            "market_data_mode": market_data["market_data_mode"],
            "market_data_connected": market_data["connected"],
        })
        while True:
            # Keep connection alive — handle client messages (pong, etc.)
            data = await ws.receive_text()
            if data == "pong":
                continue
            # Echo back any other message as acknowledgment
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        context.ws_clients.discard(ws)
        await ws_manager.disconnect(ws)


@app.websocket("/ws/updates")
async def websocket_updates_legacy(ws: WebSocket):
    """Legacy WS endpoint — redirects to /ws behavior for backward compat."""
    await ws_manager.connect(ws)
    context.ws_clients.add(ws)
    try:
        market_data = _get_market_data_status()
        await ws.send_json({
            "type": "health",
            "kill_switch_active": context.kill_switch_active,
            "mode": TRADING_MODE,
            "api_error_count": context.api_error_count,
            "guardian_triggered": context.guardian_triggered,
            "market_data_mode": market_data["market_data_mode"],
            "market_data_connected": market_data["connected"],
        })
        while True:
            data = await ws.receive_text()
            if data == "pong":
                continue
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        context.ws_clients.discard(ws)
        await ws_manager.disconnect(ws)

@app.post("/analyze-features", response_model=AnalyzeResponse)
def analyze_features_api(payload: FeaturesIn) -> AnalyzeResponse:
    feats = Features(
        spread_pct=payload.spread_pct, imbalance=payload.imbalance,
        mid_vel=payload.mid_vel, depth_decay=payload.depth_decay,
        vol_spike=payload.vol_spike, short_reversal=payload.short_reversal,
    )
    signal = build_signal(feats)
    risk_score = compute_risk_score(feats)
    decision = risk_gate(signal, risk_score)
    return AnalyzeResponse(
        signal={
            "direction": signal.direction, "confidence": signal.confidence,
            "regime": signal.regime, "horizon_minutes": signal.horizon_minutes,
            "meta": signal.meta,
        },
        risk_score=risk_score,
        decision={
            "intent": decision.intent, "approved": decision.approved,
            "size_fraction": decision.size_fraction, "reason": decision.reason,
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
                step=s.step, price=s.price,
                signal={
                    "direction": s.signal.direction, "confidence": s.signal.confidence,
                    "regime": s.signal.regime, "meta": s.signal.meta,
                },
                risk_score=s.risk_score,
                decision={
                    "intent": s.decision.intent, "approved": s.decision.approved,
                    "size_fraction": s.decision.size_fraction, "reason": s.decision.reason,
                    "risk_score": s.decision.risk_score,
                },
            )
        )
    return SimulateResponse(symbol=req.symbol, steps=steps_out)

# ---------------------------------------------------------------------------
# Static File Serving (SPA Fallback)
# ---------------------------------------------------------------------------
# This allows serving the frontend if it's built and placed in 'dist'
DIST_PATH = os.path.join(os.path.dirname(__file__), "..", "dist")



@app.get("/surge/status")
async def surge_status():
    """Surge scanner status — active alerts, watched symbols, stop-loss counts."""
    try:
        from backend.services.surge_scanner.service import get_surge_status
        return get_surge_status()
    except Exception as exc:
        return {"error": str(exc)}

@app.get("/{path:path}")
async def serve_spa(path: str):
    # Try serving the specific path first
    full_path = os.path.join(DIST_PATH, path)
    if os.path.isfile(full_path):
        return FileResponse(full_path)

    # Fallback to index.html for SPA routing
    index_path = os.path.join(DIST_PATH, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)

    # If no dist folder, return the root JSON (fallback logic already handled by root endpoint but added for completeness)
    if not path or path == "/" or path == "":
        return {
            "name": "Crypto Signal Bot API",
            "version": "2.2.0",
            "status": "online",
            "docs": "/docs",
            "health": "/health"
        }

    raise HTTPException(status_code=404, detail="Not Found")


# Background services are started inside lifespan() — see above.
