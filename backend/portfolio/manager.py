"""
The Portfolio Manager, responsible for maintaining the authoritative state of the portfolio.
"""
from collections import defaultdict
from datetime import datetime, timezone
from backend.contracts.schemas import PortfolioState, ExecutionReport, OrderSide

class PortfolioManager:
    def __init__(self, initial_balance: float, supabase_client):
        self._supabase = supabase_client
        self.state = PortfolioState(
            nav=initial_balance,
            exposure=0.0,
            positions={},
            balances={"USDT": initial_balance},
            drawdown=0.0,
        )
        self._peak_nav = initial_balance
        self._processed_fills = set()

    def process_execution_report(self, report: ExecutionReport):
        """
        Updates the portfolio state based on a new execution report.
        This is the ONLY way that portfolio state should be changed.
        """
        # --- Deduplication ---
        if report.fill_id in self._processed_fills:
            print(f"PORTFOLIO: Duplicate fill report ignored: {report.fill_id}")
            return
        self._processed_fills.add(report.fill_id)

        # --- Update Positions and Balances ---
        base_asset, quote_asset = report.symbol.split('/')

        # Initialize balances if they don't exist
        if base_asset not in self.state.balances:
            self.state.balances[base_asset] = 0.0
        if quote_asset not in self.state.balances:
             self.state.balances[quote_asset] = 0.0

        trade_value = report.quantity * report.price

        if report.side == OrderSide.BUY:
            self.state.balances[base_asset] += report.quantity
            self.state.balances[quote_asset] -= trade_value
            self.state.positions[report.symbol] = self.state.balances[base_asset]
        else: # SELL
            self.state.balances[base_asset] -= report.quantity
            self.state.balances[quote_asset] += trade_value
            self.state.positions[report.symbol] = self.state.balances[base_asset]

        # --- Update NAV and Metrics ---
        self._update_metrics()

        # --- Persist State ---
        self._save_state_to_db()

    def _update_metrics(self, current_prices: dict = None):
        """
        Recalculates NAV, exposure, and drawdown.
        In a real system, `current_prices` would be fed from a live market data feed.
        """
        if current_prices is None:
            # Using a stubbed price for now. THIS IS A CRITICAL POINT FROM THE CODE REVIEW.
            # It will be fixed when the main loop is implemented.
            current_prices = {symbol: 1.0 for symbol in self.state.positions.keys()}

        # 1. Calculate NAV
        # Sum of quote currencies + market value of base currencies
        total_asset_value = 0
        for asset, balance in self.state.balances.items():
            if asset in current_prices: # It's a base asset with a price
                 total_asset_value += balance * current_prices.get(asset, 1.0)
            else: # It's a quote currency (e.g., USD)
                 total_asset_value += balance
        self.state.nav = total_asset_value

        # 2. Update Drawdown
        if self.state.nav > self._peak_nav:
            self._peak_nav = self.state.nav

        drawdown_pct = (self._peak_nav - self.state.nav) / self._peak_nav if self._peak_nav > 0 else 0
        self.state.drawdown = drawdown_pct

        # 3. Calculate Exposure
        gross_exposure = sum(
            abs(balance * current_prices.get(asset, 1.0))
            for asset, balance in self.state.balances.items() if asset not in ["USDT"] # Exclude quote currency
        )
        self.state.exposure = gross_exposure / self.state.nav if self.state.nav > 0 else 0

    def _save_state_to_db(self):
        """Saves the current portfolio state to Supabase."""
        try:
            # This is a simplified representation. A real system would have tables for
            # positions, balances, and historical NAV.
            data, count = self._supabase.table('portfolio_state').upsert(
                {
                    "id": 1, # Singleton row for current state
                    "nav": self.state.nav,
                    "exposure": self.state.exposure,
                    "drawdown": self.state.drawdown,
                    "positions": self.state.positions,
                    "balances": self.state.balances,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).execute()
        except Exception as e:
            print(f"Error saving portfolio state to DB: {e}")
