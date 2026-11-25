"""Exchange status, connectivity, and market feed endpoints."""

from fastapi import APIRouter, Depends

from backend import app_state
from backend.logic import rate_limit

router = APIRouter(dependencies=[Depends(rate_limit.rate_limit)])


@router.get("/exchange/status")
def get_exchange_status():
    market_data = app_state.get_market_data_status()
    execution_mode = app_state.adapter().mode
    return {
        "trading_mode": app_state.trading_mode(),
        "execution_mode": execution_mode,
        "market_data_mode": market_data["market_data_mode"],
        "paper_use_live_market_data": app_state.paper_use_live_market_data(),
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


@router.get("/exchange/supported")
def get_exchange_supported():
    """Return support matrix for all exchanges."""
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
        "trading_mode": app_state.trading_mode(),
    }


@router.get("/market/feed/status")
def get_market_feed_status():
    """Return current market data feed status."""
    mds = app_state.get_market_data_status()
    symbols = mds.get("symbols", [])
    last_ts = mds.get("last_update_ts")
    stale = mds.get("stale", True)
    connected = mds.get("connected", False)
    return {
        "source": mds.get("source", "synthetic"),
        "exchange": mds.get("exchange", app_state.market_data_exchange()),
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


@router.post("/exchange/test-connection")
async def test_exchange_connection(exchange: str = "coinbase"):
    """Diagnostic connectivity test. Does NOT place real orders."""
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
        import time as _time

        import httpx
        urls = {
            "binance": "https://api.binance.us/api/v3/ping",
            "bitget": "https://api.bitget.com/api/v2/public/time",
            "btcc": "https://api.btcc.com/api/v1/info",
            "coinbase": "https://api.coinbase.com/api/v3/brokerage/products/BTC-USDT",
            "coingecko": "https://api.coingecko.com/api/v3/ping",
        }
        url = urls[exchange]
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


@router.get("/exchange/circuit-breakers")
def get_circuit_breaker_statuses():
    """Return circuit breaker state for all registered exchange adapters."""
    try:
        from backend.services.exchange_retry import get_all_circuit_breaker_statuses
        return {"circuit_breakers": get_all_circuit_breaker_statuses()}
    except Exception as exc:
        return {"circuit_breakers": [], "error": str(exc)}


@router.get("/exchange/validate")
def exchange_validation_api():
    from backend.services.testnet_validator import validate_exchange_connectivity
    result = validate_exchange_connectivity(app_state.adapter())
    return result.to_dict()


@router.get("/surge/status")
async def surge_status():
    """Surge scanner status."""
    try:
        from backend.services.surge_scanner.service import get_surge_status
        return get_surge_status()
    except Exception as exc:
        return {"error": str(exc)}
