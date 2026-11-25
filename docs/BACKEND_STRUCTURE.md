# Backend Structure

> FastAPI application with modular service architecture.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | FastAPI + Uvicorn |
| Models | Pydantic v2 |
| Database | SQLAlchemy + SQLite (Postgres-ready) |
| Testing | Pytest + pytest-asyncio |
| Linting | Ruff |
| Deployment | Docker, Render, Railway |

## Directory Layout

```
backend/
├── app.py                    # FastAPI application entry, lifespan, core routes
├── app_state.py              # Lazy accessor for app-level state (avoids circular imports)
├── exceptions.py             # Shared exception types (ExchangeAPIError)
├── render_entrypoint.py      # Render-specific app wrapper
├── public_app.py             # Public-facing app (subset of routes)
├── health_wrapper.py         # Health check wrapper
│
├── config/
│   ├── runtime.py            # RuntimeConfig dataclass, env override logic
│   ├── loader.py             # YAML config file loader
│   ├── settings.py           # Settings constants
│   ├── mode_control.py       # Trading mode configuration
│   └── config.yaml           # Default configuration file
│
├── engine/
│   ├── risk_rules.py         # Risk rule engine (6 rules)
│   ├── execution_router.py   # Multi-venue order routing
│   ├── coordinator.py        # Engine orchestration (stub)
│   ├── state_machine.py      # Intent state machine
│   ├── venue_registry.py     # Venue registry
│   ├── broker_normalizer.py  # Broker data normalization
│   ├── pnl.py                # P&L calculation helpers
│   └── routing.py            # Routing logic
│
├── policy/                   # Pure logic modules (no state)
│   ├── features.py           # Feature extraction
│   ├── indicators.py         # Technical indicators (RSI, ATR, MACD, etc.)
│   ├── signals.py            # Signal classification / regime detection
│   └── strategies.py         # Strategy evaluation / combine
│
├── risk/                     # Risk scoring and gating
│   └── scoring.py            # compute_risk_score(), risk_gate()
│
├── audit/                    # Audit persistence and tracing
│   ├── store.py              # Audit trail persistence (intents, orders, events)
│   └── tracer.py             # Decision trace ring buffer
│
├── logic/                    # Runtime logic (stateful, adapter-coupled)
│   ├── context.py            # Shared mutable state (canonical source)
│   ├── paper_trading.py      # PaperPortfolio, simulate_fill()
│   ├── exchange_adapter.py   # Exchange adapter abstraction
│   ├── earnings.py           # FIFO lot matching, P&L
│   ├── signal_engine.py      # Signal orchestration
│   ├── market_data.py        # Market data aggregation
│   ├── market_state.py       # Signal/market state caching
│   ├── rate_limit.py         # Per-IP rate limiter
│   ├── simulate.py           # Multi-step simulation
│   ├── startup_checks.py     # Boot-time validation
│   └── provider_registry.py  # Service provider registry
│
├── models/
│   ├── execution_intent.py   # ExecutionIntent, IntentRequest, IntentResponse
│   ├── risk.py               # RiskContext
│   ├── broker_models.py      # Broker-specific models
│   └── __init__.py
│
├── routes/
│   ├── audit_v1.py           # Audit, traces, metrics endpoints
│   ├── earnings_v1.py        # Earnings summary, history, reset
│   ├── analysis_v1.py        # Feature analysis, session simulation
│   ├── config_v1.py          # Config/status endpoints (/config, /version, /runtime/status)
│   ├── exchange_v1.py        # Exchange endpoints (/exchange/status, /market/feed/status)
│   ├── trading_v1.py         # Trading/portfolio/price endpoints (/balance, /positions, /orders)
│   ├── reconciliation_v1.py  # Reconciliation endpoints (/reconciliation/status)
│   ├── kill_switch.py        # Kill-switch routes (global + scoped)
│   ├── compatibility.py      # Hosted health routes (Render)
│   ├── intent.py             # Intent routes (alternative router)
│   ├── price.py              # Price routes (alternative router)
│   ├── signal.py             # Signal routes (prediction service-backed /signal/latest)
│   ├── broker.py             # Broker routes
│   ├── integrations.py       # Public integration routes
│   ├── waitlist.py           # Waitlist routes
│   └── event_log.py          # Event log routes
│
├── services/
│   ├── guardian_bot/
│   │   ├── service.py        # Guardian safety monitor (kill switch, scoped halts, reconciliation drift)
│   │   └── monitor.py        # Background loop: portfolio equity → guardian drawdown/daily loss
│   ├── reconciliation/
│   │   └── service.py        # Periodic reconciliation loop
│   ├── market_data/
│   │   ├── service.py        # Market data service (WebSocket + REST)
│   │   └── stream.py         # WebSocket stream handler
│   ├── prediction_bot/
│   │   └── service.py        # ML prediction service (stub)
│   ├── mt5_bridge/           # MetaTrader 5 integration
│   ├── audit/                # Audit service
│   └── public_integrations.py
│
├── adapters/
│   ├── exchanges/
│   │   ├── base.py           # Abstract exchange adapter + data types
│   │   ├── binance.py        # Binance adapter
│   │   ├── binance_us_ohlcv.py # Binance US OHLCV adapter
│   │   ├── bitget.py         # Bitget adapter
│   │   ├── btcc.py           # BTCC adapter
│   │   ├── coinbase.py       # Coinbase adapter
│   │   ├── coingecko.py      # CoinGecko adapter
│   │   ├── live.py           # Live adapter (disabled in paper mode)
│   │   └── retry.py          # Retry/circuit breaker utilities
│   └── brokers/
│       └── mt5.py            # MT5 broker adapter
│
├── db/
│   ├── session.py            # SQLAlchemy session management
│   ├── event_log.py          # Event log SQLite store
│   ├── models/               # SQLAlchemy ORM models
│   ├── repositories/         # Repository pattern implementations
│   └── migrations/           # Database migrations
│
├── middleware/
│   └── auth.py               # API key authentication
│
├── ws/
│   └── __init__.py           # WebSocket utilities
│
├── dependencies.py           # Shared FastAPI auth (require_auth)
│
└── tests/
    ├── test_api.py                # API contract tests
    ├── test_api_contracts.py      # Endpoint schema validation
    ├── test_dependencies.py       # Auth dependency tests
    ├── test_route_modules.py      # Extracted route module tests
    ├── test_earnings.py           # Earnings/FIFO tests
    ├── test_market_data.py        # Market data tests
    ├── test_live_mode.py          # Live mode routing tests
    ├── test_risk.py               # Risk scoring tests
    ├── test_risk_gate.py          # Risk gating / guardian tests
    ├── test_signals.py            # Signal classification tests
    ├── test_indicators.py         # Technical indicator tests
    ├── test_strategies.py         # Strategy evaluation tests
    ├── test_decision_trace.py     # Decision trace tests
    ├── test_mt5_integration.py    # MT5 broker tests
    ├── test_runtime_config.py     # Config tests
    ├── test_repo_audit.py         # Structural audit tests
    ├── test_coordinator_validation.py  # Intent validation, boundaries
    ├── test_venue_registry.py     # Venue register, availability
    ├── test_broker_normalizer.py  # Order/position/fill normalization
    ├── test_config_loader.py      # Sub-config accessors, URL redaction
    ├── test_websocket_manager.py  # Connect/disconnect, broadcast
    ├── test_state_machine.py      # Valid/invalid transitions
    ├── test_pnl_engine.py         # FIFO lot matching, partial sells
    ├── test_execution_router.py   # Venue routing (exchange + MT5)
    ├── test_portfolio_persistence.py # Save/restore, DB error resilience
    └── test_signal_endpoint.py    # Prediction-service signal endpoint
```

## Key Patterns

### State Management
All mutable state lives in `backend/logic/context.py`:
- `kill_switch_active`, `kill_switch_reason`
- `guardian_triggered`, `guardian_drawdown_pct`
- `latest_signal_by_symbol`, `latest_signal_ts_by_symbol`
- `market_data_service`
- `ws_clients` (WebSocket connections)
- `BACKEND_API_KEY`

Tests must reset `context.*` (not `app_module.*`) between runs.

### Intent Lifecycle
```
IntentRequest → ExecutionIntent(PENDING)
    → Risk Engine evaluation
        → RISK_REJECTED (with reason)
        → RISK_APPROVED → simulate_fill()
            → FILLED (with fill_price, notes)
            → FAILED (insufficient balance, etc.)
```

### Risk Rules (6 rules evaluated in order)
1. **MaxPosition** — Symbol position < 5% of account
2. **PortfolioExposure** — Total exposure < 100% of account
3. **MaxDailyLoss** — Daily loss < 3% of account
4. **Volatility** — 24h volatility < 8%
5. **Leverage** — Effective leverage < 1.0x
6. **Slippage** — Estimated slippage < 0.5%

SELL orders bypass position/exposure/leverage checks (always approved).

### Configuration Loading
```
config.yaml → loader.py → RuntimeConfig (dataclass)
                              ↑
                    Environment variables override YAML values
```

## Deployment Entrypoints

| Target | Entrypoint | Port |
|--------|-----------|------|
| Local dev | `backend.app:app` | 8000 |
| Render | `backend.render_entrypoint:app` | 10000 |
| Docker | `backend.render_entrypoint:app` | 10000 |

## Test Commands

```bash
# Full suite
python -m pytest backend/tests/ -v --tb=short

# Specific test files
python -m pytest backend/tests/test_api.py -v        # API contracts
python -m pytest backend/tests/test_earnings.py -v    # Earnings
python -m pytest backend/tests/test_market_data.py -v # Market data

# Lint
python -m ruff check backend/
```
