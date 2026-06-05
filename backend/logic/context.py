"""Shared application state and components."""
import asyncio
import json
import time
from typing import Any, Dict, List, Optional, Set
from fastapi import WebSocket
from backend.config.runtime import get_runtime_config
from backend.logic.paper_trading import PaperPortfolio, _synthetic_price
from backend.logic.exchange_adapter import ExchangeAdapter, build_adapter
from backend.engine.risk_rules import RiskRuleEngine

# Load Config
RUNTIME_CONFIG = get_runtime_config()
TRADING_MODE = RUNTIME_CONFIG.trading_mode
NETWORK = RUNTIME_CONFIG.network
EXCHANGE = RUNTIME_CONFIG.exchange
MARKET_DATA_PUBLIC_EXCHANGE = (
    RUNTIME_CONFIG.market_data_public_exchange or RUNTIME_CONFIG.exchange
)
BACKEND_API_KEY = RUNTIME_CONFIG.backend_api_key
PAPER_USE_LIVE_MARKET_DATA = RUNTIME_CONFIG.paper.use_live_market_data

# Global components
paper_portfolio: PaperPortfolio = PaperPortfolio(
    balances={"USDT": RUNTIME_CONFIG.paper.starting_balance_usdt}
)

def get_portfolio() -> PaperPortfolio:
    return paper_portfolio

def set_portfolio(p: PaperPortfolio) -> None:
    global paper_portfolio
    paper_portfolio = p

adapter: Optional[ExchangeAdapter] = None
risk_engine: Optional[RiskRuleEngine] = None
market_data_service: Any = None

# Global State
kill_switch_active = False
kill_switch_reason: Optional[str] = None
api_error_count = 0
failed_order_count = 0
ws_clients: Set[WebSocket] = set()
app_event_loop: Optional[asyncio.AbstractEventLoop] = None

latest_signal_by_symbol: Dict[str, Dict[str, Any]] = {}
latest_signal_ts_by_symbol: Dict[str, float] = {}
latest_signal_symbol: Optional[str] = None
latest_signal_ts: Optional[float] = None

guardian_triggered = False
guardian_trigger_reason: Optional[str] = None
guardian_trigger_ts: Optional[float] = None
guardian_drawdown_pct: float = 0.0
guardian_starting_nav: float = 10000.0

def unix_timestamp() -> float:
    return time.time()

async def broadcast(message: Dict[str, Any]) -> None:
    """Broadcast a message to all connected WebSocket clients.

    Optimized: pre-serializes JSON once and uses asyncio.gather for
    concurrent delivery.
    """
    if not ws_clients:
        return

    text = json.dumps(message)
    clients = list(ws_clients)

    async def _safe_send(ws: WebSocket) -> Optional[WebSocket]:
        try:
            await ws.send_text(text)
            return None
        except Exception:
            return ws

    results = await asyncio.gather(*[_safe_send(ws) for ws in clients])
    dead = [ws for ws in results if ws is not None]
    for ws in dead:
        ws_clients.discard(ws)

def schedule_background(
    async_fn: Any, *args: Any, **kwargs: Any
) -> bool:
    import anyio
    try:
        anyio.from_thread.run(async_fn, *args, **kwargs)
        return True
    except RuntimeError:
        pass
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        loop.create_task(async_fn(*args, **kwargs))
        return True
    if app_event_loop and app_event_loop.is_running():
        asyncio.run_coroutine_threadsafe(async_fn(*args, **kwargs), app_event_loop)
        return True
    return False
