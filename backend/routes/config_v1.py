"""Configuration and status endpoints."""

from fastapi import APIRouter, Depends

from backend import app_state
from backend.logic import rate_limit

router = APIRouter(dependencies=[Depends(rate_limit.rate_limit)])


@router.get("/config")
def get_config():
    cfg = app_state.runtime_config()
    return {
        "trading_mode": app_state.trading_mode(),
        "network": app_state.network(),
        "adapter": app_state.adapter().mode,
        "exchange": app_state.exchange_name(),
        "adapter_exchange": app_state.adapter().exchange,
        "market_data_public_exchange": app_state.market_data_exchange(),
        "paper_use_live_market_data": app_state.paper_use_live_market_data(),
        "config_path": cfg.config_path,
        "cors_origins": app_state.allowed_origins(),
        "kill_switch_active": app_state._app().context.kill_switch_active,
        "auth_enabled": bool(app_state.backend_api_key()),
        "rate_limit_rpm": cfg.rate_limit_rpm,
        "risk_engine": {
            "rules": [r.name for r in app_state.risk_engine().rules],
            "max_position_pct": cfg.risk.max_position_pct,
            "max_daily_loss_pct": cfg.risk.max_daily_loss_pct,
            "volatility_threshold": cfg.risk.volatility_threshold,
            "max_leverage": cfg.risk.max_leverage,
            "max_slippage_pct": cfg.risk.max_slippage_pct,
        },
    }


@router.get("/mainnet-gate/status")
def get_mainnet_gate_status():
    from backend.engine.mainnet_gate import mainnet_status
    return mainnet_status()


@router.get("/version")
def get_version():
    import sys
    return {
        "version": "1.0.0",
        "mode": app_state.trading_mode(),
        "network": app_state.network(),
        "python": sys.version.split()[0],
        "safe_mode": True,
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "paper_only": True,
    }


@router.get("/runtime/status")
def get_runtime_status():
    mds = app_state.get_market_data_status()
    from backend.services.guardian_bot import service as _gsvc
    ws_clients = len(getattr(app_state.ws_manager(), "_connections", []))
    return {
        "mode": app_state.trading_mode(),
        "network": app_state.network(),
        "safe_mode": True,
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "selected_exchange": app_state.market_data_exchange(),
        "feed_connected": mds.get("connected", False),
        "feed_stale": mds.get("stale", True),
        "feed_source": mds.get("source", "synthetic"),
        "websocket_clients": ws_clients,
        "guardian_triggered": _gsvc._triggered,
        "kill_switch_active": _gsvc._kill_switch_active,
        "drawdown_pct": _gsvc._drawdown_pct,
    }


@router.get("/config/snapshot")
def get_config_snapshot():
    import hashlib
    import json as _json

    from backend.config.runtime import get_runtime_config
    cfg = get_runtime_config()
    snapshot = {
        "trading_mode": app_state.trading_mode(),
        "network": app_state.network(),
        "market_data_source": app_state.market_data_exchange(),
        "paper_use_live_market_data": app_state.paper_use_live_market_data(),
        "live_execution_enabled": app_state.adapter().mode == "mainnet",
        "withdrawals_enabled": False,
        "safe_mode": app_state.adapter().mode != "mainnet",
        "risk": {
            "max_position_pct": cfg.risk.max_position_pct if hasattr(cfg, "risk") else None,
            "max_daily_loss_pct": cfg.risk.max_daily_loss_pct if hasattr(cfg, "risk") else None,
        },
    }
    snapshot_str = _json.dumps(snapshot, sort_keys=True)
    snapshot["config_hash"] = hashlib.sha256(snapshot_str.encode()).hexdigest()[:16]
    return snapshot
