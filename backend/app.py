"""
FastAPI backend for the Lovable AI Crypto Risk Agent - Real-Time Trade Management.
"""
import asyncio
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel

# --- Core Application Modules ---
from backend.contracts.schemas import PortfolioState, AuditEvent
from backend.intents.builder import RiskConfig
from backend.oms.manager import OrderManagementSystem
from backend.execution.gateway import get_execution_gateway
from backend.portfolio.manager import PortfolioManager
from backend.audit.logger import AuditLogger
from backend.governance.gates import Governance
from backend.recon.checker import ReconciliationEngine
from backend.supabase_client import supabase
from backend.ops.loop import trading_loop

app = FastAPI(title="Lovable AI Crypto Risk Agent", version="3.0.0")

# ============================================================
# System Components (Singletons)
# ============================================================
# In a larger application, you might use a proper dependency injection framework.
# For now, we'll instantiate them here as singletons.

governance = Governance()
audit_logger = AuditLogger(supabase_client=supabase)
portfolio_manager = PortfolioManager(initial_balance=10000.0, supabase_client=supabase)
# The paper adapter is the default, safe-by-default execution venue.
execution_gateway = get_execution_gateway("paper")
oms = OrderManagementSystem(supabase_client=supabase)
risk_config = RiskConfig(
    max_gross_exposure=1.0,
    max_symbol_exposure=0.5,
    base_sizing_fraction=0.1,
    amber_size_reduction=0.5
)
reconciliation_engine = ReconciliationEngine(oms, execution_gateway, governance)

# ============================================================
# Background Task (The Automation Loop)
# ============================================================
@app.on_event("startup")
async def startup_event():
    """On application startup, launch the trading loop in the background."""
    print("Application startup: Launching the trading loop.")
    asyncio.create_task(trading_loop(
        governance=governance,
        audit_logger=audit_logger,
        portfolio_manager=portfolio_manager,
        oms=oms,
        execution_gateway=execution_gateway,
        risk_config=risk_config,
        loop_interval_seconds=5 # Run the loop every 5 seconds
    ))

# ============================================================
# API Models
# ============================================================
class StatusResponse(BaseModel):
    trading_enabled: bool
    is_frozen: bool
    global_kill_switch: bool
    loop_running: bool # We'll just assume it's running if the app is up
    posture: str # Placeholder for a more detailed posture status
    last_run_timestamp: str # Placeholder

# ============================================================
# API Endpoints
# ============================================================
@app.get("/status", response_model=StatusResponse)
def get_status():
    """Get the current operational status of the trading system."""
    return StatusResponse(
        trading_enabled=governance.trading_enabled,
        is_frozen=governance.is_frozen,
        global_kill_switch=governance.global_kill_switch,
        loop_running=True, # Simplified health check
        posture="GREEN", # This would be fetched from a live state manager
        last_run_timestamp="N/A" # This would be updated by the loop
    )

@app.post("/admin/freeze")
def admin_freeze():
    """ADMIN: Manually freezes the trading system."""
    governance.freeze()
    audit_logger.log_event("ADMIN", "GOVERNANCE_FREEZE", {"source": "API"})
    return {"message": "Trading frozen."}

@app.post("/admin/unfreeze")
def admin_unfreeze():
    """ADMIN: Manually unfreezes the trading system."""
    governance.unfreeze()
    audit_logger.log_event("ADMIN", "GOVERNANCE_UNFREEZE", {"source": "API"})
    return {"message": "Trading unfrozen."}

@app.post("/admin/kill-switch")
def admin_kill_switch():
    """ADMIN: Manually engages the global kill switch."""
    governance.engage_kill_switch()
    audit_logger.log_event("ADMIN", "GOVERNANCE_KILL_SWITCH_ON", {"source": "API"})
    return {"message": "Global kill switch engaged."}

@app.get("/orders/latest", response_model=List[Dict])
def get_latest_orders():
    """Get the latest orders from the database."""
    # Note: This reads from the DB, not the in-memory OMS state, which is better for an API
    data = supabase.table("orders").select("*").order("created_at", desc=True).limit(20).execute()
    return data.data

@app.get("/portfolio", response_model=PortfolioState)
def get_portfolio():
    """Get the current portfolio state."""
    # Returns the in-memory state, which is the most up-to-date
    return portfolio_manager.state

@app.get("/audit/recent", response_model=List[AuditEvent])
def get_recent_audit_events():
    """Get the 50 most recent audit trail events."""
    data = supabase.table("audit_events").select("*").order("timestamp", desc=True).limit(50).execute()
    return data.data

# You can add back other informational endpoints like /signals/latest if needed.
# For now, the focus is on the core trade management endpoints.
