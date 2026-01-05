"""
FastAPI backend for the Lovable AI Crypto Risk Agent.
"""
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from backend.contracts.schemas import Signal, MarketPosture, ExecutionIntent, PortfolioState, AuditEvent
from backend.logic.features import compute_features
from backend.logic.signals import build_signal
from backend.posture.engine import calculate_posture
from backend.intents.builder import build_intent, RiskConfig
from backend.oms.manager import OrderManagementSystem
from backend.execution.gateway import get_execution_gateway
from backend.portfolio.manager import PortfolioManager
from backend.audit.logger import AuditLogger
from backend.governance.gates import Governance, assert_trading_allowed, TradingHaltedError
from backend.supabase_client import supabase

app = FastAPI(title="Lovable AI Crypto Risk Agent", version="2.0.0")

# ============================================================
# System Components (Singletons)
# ============================================================
governance = Governance()
audit_logger = AuditLogger(supabase_client=supabase)
portfolio_manager = PortfolioManager(initial_balance=10000.0, supabase_client=supabase)
oms = OrderManagementSystem(supabase_client=supabase)
risk_config = RiskConfig(max_gross_exposure=1.0, max_symbol_exposure=0.5, base_sizing_fraction=0.1, amber_size_reduction=0.5)

# ============================================================
# API Models
# ============================================================
class StatusResponse(BaseModel):
    trading_enabled: bool
    is_frozen: bool
    global_kill_switch: bool

# ============================================================
# Core Trading Pipeline
# ============================================================
def trading_pipeline_step(symbol: str, is_data_stale: bool, features):
    # This function represents a single step of the trading pipeline.
    # In a real system, this would be triggered by a new market data event.

    # 1. Generate Signal
    signal = build_signal(features)
    audit_logger.log_event(signal.meta.get("trace_id", "trace_unknown"), "SIGNAL_GENERATED", signal.model_dump())

    # 2. Determine Posture
    posture = calculate_posture(signal, is_data_stale)
    audit_logger.log_event(signal.meta.get("trace_id", "trace_unknown"), "POSTURE_DETERMINED", posture.model_dump())

    # 3. Build Intent
    intent = build_intent(signal, posture, portfolio_manager.state, risk_config, symbol)
    audit_logger.log_event(intent.intent_id, "INTENT_BUILT", intent.model_dump())

    # 4. Submit to OMS
    order = oms.submit_intent(intent)
    audit_logger.log_event(intent.intent_id, "ORDER_CREATED", order.model_dump())

    # 5. Governance Check
    try:
        assert_trading_allowed(governance, venue_id="bitget")
    except TradingHaltedError as e:
        audit_logger.log_event(intent.intent_id, "EXECUTION_HALTED", {"reason": str(e)})
        return

    # 6. Execute (Stubbed)
    if order.status == "NEW":
        execution_gateway = get_execution_gateway("bitget")
        if execution_gateway.place_order(order):
            oms.update_order_status(order.order_id, "SENT")
            audit_logger.log_event(intent.intent_id, "ORDER_SENT", {"order_id": order.order_id})
        else:
            oms.update_order_status(order.order_id, "REJECTED")
            audit_logger.log_event(intent.intent_id, "ORDER_REJECTED", {"order_id": order.order_id})

# ============================================================
# API Endpoints
# ============================================================
@app.get("/status", response_model=StatusResponse)
def get_status():
    return StatusResponse(
        trading_enabled=governance.trading_enabled,
        is_frozen=governance.is_frozen,
        global_kill_switch=governance.global_kill_switch
    )

@app.get("/signals/latest", response_model=List[Signal])
def get_latest_signals():
    data = supabase.table("signals").select("*").order("created_at", desc=True).limit(10).execute()
    return data.data

@app.get("/posture/latest", response_model=List[MarketPosture])
def get_latest_posture():
    data = supabase.table("posture_events").select("*").order("created_at", desc=True).limit(1).execute()
    return data.data

@app.get("/intents/latest", response_model=List[ExecutionIntent])
def get_latest_intents():
    data = supabase.table("execution_intents").select("*").order("created_at", desc=True).limit(10).execute()
    return data.data

@app.get("/orders/latest", response_model=List[Dict])
def get_latest_orders():
    data = supabase.table("orders").select("*").order("created_at", desc=True).limit(10).execute()
    return data.data

@app.get("/portfolio", response_model=PortfolioState)
def get_portfolio():
    return portfolio_manager.state

@app.get("/audit/recent", response_model=List[AuditEvent])
def get_recent_audit_events():
    data = supabase.table("audit_events").select("*").order("created_at", desc=True).limit(20).execute()
    return data.data

@app.get("/trace/{intent_id}", response_model=List[AuditEvent])
def get_trace(intent_id: str):
    data = supabase.table("audit_events").select("*").eq("trace_id", intent_id).order("created_at", desc=True).execute()
    if not data.data:
        raise HTTPException(status_code=404, detail="Trace not found")
    return data.data
