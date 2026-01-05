"""
Portfolio Truth Engine
"""
from typing import Dict, Set
from backend.contracts.schemas import ExecutionReport, PortfolioState
from backend.supabase_client import supabase

class PortfolioManager:
    def __init__(self, initial_balance: float, supabase_client):
        self.supabase = supabase_client
        self.state = PortfolioState(
            nav=initial_balance,
            exposure=0.0,
            positions={},
            balances={"USDT": initial_balance},
            drawdown=0.0
        )
        self.processed_fills: Set[str] = set()

    def process_fill(self, fill: ExecutionReport):
        fill_key = f"{fill.venue_order_id}_{fill.fill_id}"
        if fill_key in self.processed_fills:
            return

        if fill.side == "BUY":
            self.state.positions[fill.symbol] = self.state.positions.get(fill.symbol, 0.0) + fill.quantity
            self.state.balances["USDT"] -= fill.quantity * fill.price
        else: # SELL
            self.state.positions[fill.symbol] = self.state.positions.get(fill.symbol, 0.0) - fill.quantity

        self.state.nav = self.state.balances["USDT"] + sum(p * 1.0 for p in self.state.positions.values()) # Assuming price of 1.0 for now

        self.processed_fills.add(fill_key)

        # Persist to Supabase
        self.supabase.table("execution_reports").insert(fill.model_dump()).execute()
        self.supabase.table("portfolio_snapshots").insert(self.state.model_dump()).execute()
