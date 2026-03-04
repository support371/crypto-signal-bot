"""
Execution Gateway Service.

Routes trading intents through:
1. Kill-switch check
2. 5-Rule risk validation
3. Paper mode → simulate_fill  OR  Live mode → Exchange client
4. State machine transitions
5. Audit trail persistence
6. WebSocket broadcast

This is the single entry point for all order execution.
"""

import time
import logging
from typing import Any, Dict, Optional

from backend.models.execution_intent import (
    ExecutionIntent,
    IntentRequest,
    IntentResponse,
    IntentStatus,
    Side,
)
from backend.models.risk import RiskContext
from backend.engine.risk_rules import RiskRuleEngine, RiskEngineResult
from backend.engine.state_machine import transition, StateTransitionError
from backend.logic.paper_trading import PaperPortfolio, simulate_fill, _synthetic_price
from backend.logic.audit_store import append_intent, append_order, append_risk_event
from backend.exchanges.base_client import BaseExchangeClient

logger = logging.getLogger("gateway")


class ExecutionGateway:
    """
    Central execution gateway that routes intents to paper or live execution.

    Attributes:
        paper_portfolio: In-memory paper trading portfolio
        risk_engine: 5-rule risk engine instance
        exchange_client: Live exchange client (Bitget/BTCC), or None if paper-only
        trading_mode: "paper" or "live"
        kill_switch_active: Emergency halt flag
    """

    def __init__(
        self,
        paper_portfolio: PaperPortfolio,
        risk_engine: RiskRuleEngine,
        exchange_client: Optional[BaseExchangeClient] = None,
        trading_mode: str = "paper",
    ):
        self.paper_portfolio = paper_portfolio
        self.risk_engine = risk_engine
        self.exchange_client = exchange_client
        self.trading_mode = trading_mode
        self.kill_switch_active = False
        self.kill_switch_reason: Optional[str] = None
        self.api_error_count = 0
        self.failed_order_count = 0
        # Daily P&L tracking
        self._daily_pnl = 0.0
        self._daily_reset_ts = time.time()

    def activate_kill_switch(self, reason: str):
        """Activate the emergency kill switch."""
        self.kill_switch_active = True
        self.kill_switch_reason = reason
        logger.critical("KILL SWITCH ACTIVATED: %s", reason)

    def deactivate_kill_switch(self):
        """Deactivate the kill switch (manual reset)."""
        self.kill_switch_active = False
        self.kill_switch_reason = None
        logger.info("Kill switch deactivated")

    def _check_kill_switch(self):
        """Check and auto-trigger kill switch conditions."""
        if self.kill_switch_active:
            return

        if self.api_error_count >= 10:
            self.activate_kill_switch(
                f"Too many API errors: {self.api_error_count}"
            )
        elif self.failed_order_count >= 5:
            self.activate_kill_switch(
                f"Too many failed orders: {self.failed_order_count}"
            )

    def _get_market_price(self, symbol: str) -> float:
        """Get market price from exchange (live) or synthetic (paper)."""
        if self.trading_mode == "live" and self.exchange_client:
            try:
                ticker = self.exchange_client.get_ticker(symbol)
                return ticker["last"]
            except Exception as e:
                logger.warning("Failed to get live price for %s: %s, using synthetic", symbol, e)
                self.api_error_count += 1
                self._check_kill_switch()
                return _synthetic_price(symbol)
        return _synthetic_price(symbol)

    def _get_account_balance(self) -> float:
        """Get account balance from exchange (live) or paper portfolio."""
        if self.trading_mode == "live" and self.exchange_client:
            try:
                balances = self.exchange_client.get_balance()
                return balances.get("USDT", 0.0)
            except Exception as e:
                logger.warning("Failed to get live balance: %s, using paper", e)
                self.api_error_count += 1
                self._check_kill_switch()
                return self.paper_portfolio.get_balance("USDT")
        return self.paper_portfolio.get_balance("USDT")

    def _build_risk_context(
        self, intent: ExecutionIntent, market_price: float
    ) -> RiskContext:
        """Build risk context from intent and current state."""
        account_balance = self._get_account_balance()

        return RiskContext(
            symbol=intent.symbol,
            side=intent.side.value,
            quantity=intent.quantity,
            price=market_price,
            current_position_value=0.0,  # TODO: track open position value
            daily_pnl=self._daily_pnl,
            account_balance=account_balance,
            volatility_24h=0.02,  # TODO: compute from market data
        )

    def _execute_live(self, intent: ExecutionIntent) -> ExecutionIntent:
        """Execute order on live exchange."""
        if not self.exchange_client:
            return transition(
                intent, IntentStatus.FAILED,
                notes="No exchange client configured for live trading",
            )

        try:
            # Submit to exchange
            result = self.exchange_client.place_order(
                symbol=intent.symbol,
                side=intent.side.value,
                order_type=intent.order_type.value,
                quantity=intent.quantity,
                price=intent.price,
                time_in_force=intent.time_in_force.value,
            )

            intent = transition(
                intent, IntentStatus.SUBMITTED,
                notes=f"Submitted to {self.exchange_client.name}: order_id={result['order_id']}",
            )

            # Poll for fill status (simple immediate check)
            order_status = self.exchange_client.get_order(
                intent.symbol, result["order_id"]
            )

            if order_status["status"] == "FILLED":
                intent = transition(
                    intent, IntentStatus.FILLED,
                    fill_price=order_status.get("fill_price"),
                    fill_quantity=order_status.get("fill_quantity") or intent.quantity,
                    notes=f"Filled on {self.exchange_client.name} at {order_status.get('fill_price')}",
                )
            elif order_status["status"] == "PARTIALLY_FILLED":
                intent = transition(
                    intent, IntentStatus.PARTIALLY_FILLED,
                    fill_price=order_status.get("fill_price"),
                    fill_quantity=order_status.get("fill_quantity"),
                    notes=f"Partially filled: {order_status.get('fill_quantity')} of {intent.quantity}",
                )
            elif order_status["status"] in ("CANCELLED", "FAILED"):
                intent = transition(
                    intent, IntentStatus.FAILED,
                    notes=f"Order {order_status['status']} on {self.exchange_client.name}",
                )
            # else: still SUBMITTED, will be tracked asynchronously

        except StateTransitionError as e:
            logger.error("State machine error: %s", e)
            intent.notes = f"State machine error: {e}"
        except Exception as e:
            logger.error("Live execution error: %s", e)
            self.api_error_count += 1
            self._check_kill_switch()
            try:
                intent = transition(
                    intent, IntentStatus.FAILED,
                    notes=f"Exchange error: {e}",
                )
            except StateTransitionError:
                intent.notes = f"Exchange error: {e}"

        return intent

    def _execute_paper(self, intent: ExecutionIntent) -> ExecutionIntent:
        """Execute order in paper mode."""
        market_price = self._get_market_price(intent.symbol)

        try:
            intent = transition(intent, IntentStatus.SUBMITTED, notes="Paper mode submission")
        except StateTransitionError as e:
            logger.error("State transition error: %s", e)
            return intent

        # Use existing paper fill logic
        filled_intent = simulate_fill(intent, self.paper_portfolio, market_price)

        # Map the result back through state machine
        if filled_intent.status == IntentStatus.FILLED:
            # simulate_fill already set the status, just log
            logger.info("Paper fill: %s %s %s at %s",
                         intent.side.value, intent.quantity, intent.symbol, filled_intent.fill_price)
        elif filled_intent.status == IntentStatus.FAILED:
            self.failed_order_count += 1
            self._check_kill_switch()

        return filled_intent

    def process_intent(self, req: IntentRequest, mode: str) -> IntentResponse:
        """
        Process a trading intent through the full pipeline.

        Pipeline:
        1. Kill-switch check
        2. Create ExecutionIntent (PENDING)
        3. 5-rule risk validation -> RISK_APPROVED or RISK_REJECTED
        4. Route to paper or live execution
        5. Persist to audit trail
        6. Return response

        Args:
            req: The intent request from the API
            mode: "paper" or "live"

        Returns:
            IntentResponse with status and notes
        """
        # 1. Kill switch
        if self.kill_switch_active:
            return IntentResponse(
                id="blocked",
                status="REJECTED",
                notes=f"Kill switch active: {self.kill_switch_reason}",
            )

        # 2. Create intent
        intent = ExecutionIntent(
            symbol=req.symbol.upper(),
            side=req.side,
            order_type=req.order_type,
            quantity=req.quantity,
            price=req.price,
            time_in_force=req.time_in_force,
            mode=mode,
        )

        # 3. Risk validation
        market_price = self._get_market_price(intent.symbol)
        risk_ctx = self._build_risk_context(intent, market_price)
        risk_result = self.risk_engine.evaluate(risk_ctx)

        if not risk_result.approved:
            try:
                intent = transition(
                    intent, IntentStatus.RISK_REJECTED,
                    notes=f"Risk rejected: {risk_result.reason}",
                )
            except StateTransitionError:
                intent.status = IntentStatus.RISK_REJECTED
                intent.notes = f"Risk rejected: {risk_result.reason}"

            append_risk_event({
                "intent_id": intent.id,
                "risk_result": risk_result.to_dict(),
                "reason": risk_result.reason,
            })
            append_intent(intent.model_dump())

            return IntentResponse(
                id=intent.id,
                status=intent.status.value,
                notes=intent.notes,
            )

        # Risk approved — apply size adjustment
        if risk_result.size_multiplier < 1.0:
            adjusted_qty = intent.quantity * risk_result.size_multiplier
            logger.info("Risk engine reduced quantity: %s -> %s (multiplier: %s)",
                         intent.quantity, adjusted_qty, risk_result.size_multiplier)
            intent.quantity = round(adjusted_qty, 8)

        try:
            intent = transition(
                intent, IntentStatus.RISK_APPROVED,
                notes=f"Risk approved: {risk_result.reason}",
            )
        except StateTransitionError:
            intent.status = IntentStatus.RISK_APPROVED

        # 4. Route execution
        if mode == "live" and self.trading_mode == "live":
            intent = self._execute_live(intent)
        else:
            intent = self._execute_paper(intent)

        # 5. Persist
        intent_data = intent.model_dump()
        append_intent(intent_data)
        if intent.status == IntentStatus.FILLED:
            append_order(intent_data)

        # Track P&L for daily loss calculation
        if intent.status == IntentStatus.FILLED and intent.fill_price:
            if intent.side == Side.SELL:
                # Approximate P&L (simplified)
                self._daily_pnl += intent.fill_price * (intent.fill_quantity or intent.quantity)
            else:
                self._daily_pnl -= intent.fill_price * (intent.fill_quantity or intent.quantity)

        # 6. Return response
        return IntentResponse(
            id=intent.id,
            status=intent.status.value,
            notes=intent.notes,
        )

    def get_live_balance(self) -> Dict[str, Any]:
        """Get balance from exchange (live) or paper portfolio."""
        if self.trading_mode == "live" and self.exchange_client:
            try:
                balances = self.exchange_client.get_balance()
                return {"source": self.exchange_client.name, "balances": balances}
            except Exception as e:
                logger.warning("Failed to get live balance: %s", e)
                self.api_error_count += 1
                self._check_kill_switch()

        return {
            "source": "paper",
            "balances": self.paper_portfolio.get_all_balances(),
        }

    def get_live_orders(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """Get open orders from exchange (live) or paper portfolio."""
        if self.trading_mode == "live" and self.exchange_client:
            try:
                orders = self.exchange_client.get_open_orders(symbol)
                return {"source": self.exchange_client.name, "orders": orders}
            except Exception as e:
                logger.warning("Failed to get live orders: %s", e)
                self.api_error_count += 1
                self._check_kill_switch()

        paper_orders = self.paper_portfolio.open_orders
        if symbol:
            paper_orders = [o for o in paper_orders if o.symbol == symbol.upper()]

        return {
            "source": "paper",
            "orders": [
                {
                    "order_id": o.id,
                    "symbol": o.symbol,
                    "side": o.side.value,
                    "order_type": o.order_type.value,
                    "quantity": o.quantity,
                    "price": o.price,
                    "status": o.status.value,
                }
                for o in paper_orders
            ],
        }

    def get_live_price(self, symbol: str) -> Dict[str, Any]:
        """Get price from exchange (live) or synthetic."""
        if self.trading_mode == "live" and self.exchange_client:
            try:
                ticker = self.exchange_client.get_ticker(symbol)
                return {"source": self.exchange_client.name, **ticker}
            except Exception as e:
                logger.warning("Failed to get live price: %s", e)
                self.api_error_count += 1
                self._check_kill_switch()

        price = _synthetic_price(symbol)
        return {
            "source": "synthetic",
            "symbol": symbol,
            "last": price,
            "bid": price * 0.999,
            "ask": price * 1.001,
            "timestamp": time.time(),
        }

    def health_status(self) -> Dict[str, Any]:
        """Get gateway health status."""
        return {
            "kill_switch_active": self.kill_switch_active,
            "kill_switch_reason": self.kill_switch_reason,
            "api_error_count": self.api_error_count,
            "failed_order_count": self.failed_order_count,
            "trading_mode": self.trading_mode,
            "exchange": self.exchange_client.name if self.exchange_client else "none",
            "daily_pnl": round(self._daily_pnl, 2),
        }
