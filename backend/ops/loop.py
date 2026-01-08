"""
The main operational loop for the trading bot.
"""
import asyncio
import random
from collections import deque
from typing import List, Optional
from backend.logic.features import compute_features
from backend.logic.signals import build_signal
from backend.posture.engine import calculate_posture
from backend.intents.builder import build_intent, RiskConfig
from backend.simulation.models import MarketTick, Features
from backend.governance.gates import assert_trading_allowed, TradingHaltedError

# --- Simulation Helpers ---
def simulate_tick(price: float) -> MarketTick:
    """Generates a single synthetic tick."""
    drift = random.uniform(-0.001, 0.001)
    price *= (1.0 + drift)
    spread = price * random.uniform(0.0005, 0.003)
    return MarketTick(
        ts=asyncio.get_event_loop().time(),
        price=price,
        bid=price - spread / 2,
        ask=price + spread / 2,
        bid_size=random.uniform(1.0, 10.0),
        ask_size=random.uniform(1.0, 10.0),
    )

async def trading_loop(
    governance,
    audit_logger,
    portfolio_manager,
    oms,
    execution_gateway,
    risk_config,
    loop_interval_seconds=5
):
    """The main asynchronous trading loop."""
    print("🚀 Trading loop started.")

    # Simulation state
    price = 30000.0
    window: deque[MarketTick] = deque(maxlen=30)
    prev_depth: Optional[float] = None

import uuid

    while True:
        try:
            start_time = asyncio.get_event_loop().time()
            trace_id = f"trace-{uuid.uuid4()}" # Generate a unique ID for this loop iteration

            # 1. Simulate Market Data & Compute Features
            tick = simulate_tick(price)
            price = tick.price # Update price for next iteration
            window.append(tick)

            # Need at least 2 ticks to compute velocity
            if len(window) < 2:
                await asyncio.sleep(loop_interval_seconds)
                continue

            features: Features = compute_features(list(window), prev_depth)
            prev_depth = tick.bid_size + tick.ask_size
            is_data_stale = False # In real system, this would be a check

            # --- Core Pipeline ---
            # 2. Generate Signal
            signal = build_signal(features, trace_id=trace_id)
            audit_logger.log_event(trace_id, "SIGNAL_GENERATED", signal.model_dump())

            # 3. Determine Posture
            posture = calculate_posture(signal, is_data_stale)
            audit_logger.log_event(trace_id, "POSTURE_DETERMINED", posture.model_dump())

            # 4. Build Intent
            intent = build_intent(signal, posture, portfolio_manager.state, risk_config, "BTC/USDT")
            audit_logger.log_event(intent.intent_id, "INTENT_BUILT", intent.model_dump())

            # 5. Submit to OMS
            order = oms.submit_intent(intent)
            if order:
                audit_logger.log_event(intent.intent_id, "ORDER_CREATED", order.__dict__)

            # --- Execution and State Update ---
            try:
                # 6. Governance Check before execution
                assert_trading_allowed(governance, venue_id="paper")

                # 7. Process new orders
                new_orders = [o for o in oms.get_open_orders() if o.status == "NEW"]
                for order_to_place in new_orders:
                    # Pass the OMS status update method as the callback
                    if execution_gateway.place_order(order_to_place, oms.update_order_status):
                        oms.update_order_status(order_to_place.client_order_id, "SENT")
                        audit_logger.log_event(order_to_place.intent_id, "ORDER_SENT", {"order_id": order_to_place.order_id})
                    else:
                        oms.update_order_status(order_to_place.client_order_id, "REJECTED")
                        audit_logger.log_event(order_to_place.intent_id, "ORDER_REJECTED", {"order_id": order_to_place.order_id})

            except TradingHaltedError as e:
                audit_logger.log_event(trace_id, "EXECUTION_HALTED", {"reason": str(e)})

            # 8. Drive the paper adapter and process fills
            # The paper adapter needs a way to generate and return reports.
            # For now, we'll assume it has a `tick` method that returns fills.
            if hasattr(execution_gateway, "tick"):
                reports = execution_gateway.tick(price)
                for report in reports:
                    oms.on_execution_report(report)
                    portfolio_manager.process_execution_report(report)
                    # The execution report doesn't have an intent_id, so we use the client_order_id
                    # A more robust system might link this back in the OMS
                    audit_logger.log_event(
                        report.client_order_id, "EXECUTION_REPORT_PROCESSED",
                        {"client_order_id": report.client_order_id, "fill_id": report.fill_id}
                    )

            # 9. Reconcile (Placeholder)
            # reconcile_state()

            # 10. Update Portfolio Metrics with latest price
            portfolio_manager._update_metrics(current_prices={"BTC/USDT": price})

            # --- Loop Timing ---
            end_time = asyncio.get_event_loop().time()
            await asyncio.sleep(max(0, loop_interval_seconds - (end_time - start_time)))

        except Exception as e:
            print(f"FATAL ERROR in trading loop: {e}")
            # In a real system, you'd have more robust error handling and alerting here.
            await asyncio.sleep(loop_interval_seconds)
