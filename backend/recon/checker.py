"""
Reconciliation Engine
"""
from backend.portfolio.manager import PortfolioManager
from backend.governance.gates import Governance

def reconcile(portfolio_manager: PortfolioManager, governance: Governance, venue_positions: dict):
    internal_positions = portfolio_manager.state.positions
    if internal_positions != venue_positions:
        governance.set_freeze_mode(True, "Reconciliation mismatch detected.")
        return False
    return True
