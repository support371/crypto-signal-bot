"""
FastAPI backend for the Crypto Signal Bot.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

from backend.config.runtime import get_runtime_config
from backend.logic import context, rate_limit  # noqa: F401 — rate_limit accessed by tests via backend.app
from backend.audit.store import (
    append_intent,
    append_order,
    append_risk_event,
    append_trace,
)
from backend.models.decision_trace import (
    DecisionTrace,
    GuardianSnapshot,
    RuleTrace,
    SignalSnapshot,
)
from backend.logic.earnings import (
    record_fill as earnings_record_fill,
)
from backend.logic.exchange_adapter import ExchangeAdapter, build_adapter
from backend.logic.market_data import BasePublicMarketDataService, build_public_market_data_service
from backend.logic.startup_checks import run as run_startup_checks
from backend.logic.paper_trading import (
    PaperPortfolio,
    _parse_symbol,
    _synthetic_price,
)
from backend.engine.risk_rules import RiskRuleEngine
from backend.engine.mainnet_gate import assert_not_mainnet, MainnetGateError
from backend.models.risk import RiskContext
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
from backend.services.guardian_bot.service import TradingScopeHaltedError, assert_scope_allowed
from backend.logic.market_state import build_market_state_result
from backend.services.reconciliation.service import (
    start_reconciliation,
    stop_reconciliation,
)
from backend.services.stream_service import handle_stream_client
from backend.services.websocket_manager import (
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
COINGECKO_WARM_CACHE_TIMEOUT_SECONDS = 5.0


async def _warm_coingecko_cache() -> None:
    """Best-effort cache prewarm that cannot block application startup."""
    try:
        from backend.adapters.exchanges.coingecko import warm_cache

        await asyncio.wait_for(
            warm_cache(),
            timeout=COINGECKO_WARM_CACHE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "CoinGecko pre-warm timed out after %.1fs (non-fatal)",
            COINGECKO_WARM_CACHE_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("CoinGecko pre-warm skipped (non-fatal): %s", exc)


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
    await _warm_coingecko_cache()

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

# Phase 4 — Include public and compatibility routers
from backend.routes.compatibility import compatibility_router
from backend.routes.integrations import integrations_router
from backend.routes.kill_switch import router as kill_switch_router
from backend.routes.waitlist import waitlist_router
from backend.routes.signals_v1 import router as signals_v1_router
from backend.routes.portfolio_v1 import router as portfolio_v1_router
from backend.routes.risk_v1 import router as risk_v1_router
from backend.routes.console_v1 import router as console_v1_router
from backend.routes.earnings_v1 import router as earnings_v1_router
from backend.routes.monitor_v1 import router as monitor_v1_router
from backend.routes.decisions_v1 import router as decisions_v1_router
from backend.replay.routes import router as replay_v1_router
from backend.backtest.routes import router as backtest_v1_router
from backend.routes.audit_v1 import router as audit_v1_router
from backend.routes.analysis_v1 import router as analysis_v1_router
from backend.routes.config_v1 import router as config_v1_router
from backend.routes.exchange_v1 import router as exchange_v1_router
from backend.routes.trading_v1 import router as trading_v1_router
from backend.routes.reconciliation_v1 import router as reconciliation_v1_router
from backend.routes.signal import router as signal_router

# Track already registered paths to avoid duplicates
# NOTE: price_router excluded — app.py defines /price and /exchange/status
# with synthetic fallback; the routes/price.py router requires a live
# MarketDataService and would shadow the synthetic-safe defaults.
_registered_paths = {getattr(route, "path", None) for route in app.routes}
for _router in (compatibility_router, integrations_router, waitlist_router, kill_switch_router, signals_v1_router, portfolio_v1_router, risk_v1_router, console_v1_router, monitor_v1_router, decisions_v1_router, replay_v1_router, backtest_v1_router, audit_v1_router, earnings_v1_router, analysis_v1_router, config_v1_router, exchange_v1_router, trading_v1_router, reconciliation_v1_router, signal_router):
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
# Exceptions
# ---------------------------------------------------------------------------
from backend.exceptions import ExchangeAPIError  # noqa: E402

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

_IDEMPOTENCY_CACHE: dict[str, str] = {}
_IDEMPOTENCY_CACHE_MAX = 10_000

def _check_idempotency(key: str | None) -> str | None:
    """Return the intent ID of a previous execution if this key was already processed."""
    if key is None:
        return None
    return _IDEMPOTENCY_CACHE.get(key)

def _record_idempotency(key: str | None, intent_id: str) -> None:
    if key is None:
        return
    if len(_IDEMPOTENCY_CACHE) >= _IDEMPOTENCY_CACHE_MAX:
        oldest = next(iter(_IDEMPOTENCY_CACHE))
        del _IDEMPOTENCY_CACHE[oldest]
    _IDEMPOTENCY_CACHE[key] = intent_id


def _process_intent(req: IntentRequest, mode: str) -> IntentResponse:
    previous_id = _check_idempotency(req.idempotency_key)
    if previous_id is not None:
        return IntentResponse(
            id=previous_id,
            status="DUPLICATE_REJECTED",
            notes=f"Duplicate intent rejected: idempotency_key already processed (original={previous_id})",
        )

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
        idempotency_key=req.idempotency_key,
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
        _record_idempotency(req.idempotency_key, intent.id)


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

# Inline endpoints extracted to route modules:
# - Config/status → routes/config_v1.py
# - Exchange/market → routes/exchange_v1.py
# - Trading/portfolio → routes/trading_v1.py
# - Reconciliation → routes/reconciliation_v1.py
# - Audit/traces/metrics → routes/audit_v1.py
# - Earnings → routes/earnings_v1.py
# - Analysis/simulation → routes/analysis_v1.py

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


# ---------------------------------------------------------------------------
# Static File Serving (SPA Fallback)
# ---------------------------------------------------------------------------
# This allows serving the frontend if it's built and placed in 'dist'
DIST_PATH = os.path.join(os.path.dirname(__file__), "..", "dist")

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
