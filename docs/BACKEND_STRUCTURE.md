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
├── app.py                    # FastAPI application entry, all route handlers
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
│   ├── gateway_service.py    # Execution gateway
│   ├── state_machine.py      # Intent state machine
│   ├── venue_registry.py     # Venue registry
│   ├── broker_normalizer.py  # Broker data normalization
│   ├── pnl.py                # P&L calculation helpers
│   ├── routing.py            # Routing logic
│   └── withdrawal_manager.py # Withdrawal handling
│
├── logic/
│   ├── context.py            # Shared mutable state (canonical source)
│   ├── paper_trading.py      # PaperPortfolio, simulate_fill()
│   ├── exchange_adapter.py   # Exchange adapter abstraction
│   ├── earnings.py           # FIFO lot matching, P&L
│   ├── signals.py            # Signal classification
│   ├── features.py           # Feature extraction
│   ├── risk.py               # Risk scoring
│   ├── market_data.py        # Market data aggregation
│   ├── market_state.py       # Signal/market state caching
│   ├── audit_store.py        # Audit trail persistence
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
│   ├── kill_switch.py        # Kill-switch routes (global + scoped)
│   ├── compatibility.py      # Hosted health routes (Render)
│   ├── intent.py             # Intent routes (alternative router)
│   ├── price.py              # Price routes (alternative router)
│   ├── signal.py             # Signal routes
│   ├── broker.py             # Broker routes
│   ├── integrations.py       # Public integration routes
│   ├── waitlist.py           # Waitlist routes
│   └── event_log.py          # Event log routes
│
├── services/
│   ├── guardian_bot/
│   │   └── service.py        # Guardian safety monitor
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
│   │   ├── base.py           # Abstract exchange adapter
│   │   ├── binance.py        # Binance adapter
│   │   ├── bitget.py         # Bitget adapter (stub)
│   │   └── btcc.py           # BTCC adapter (stub)
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
└── tests/
    ├── test_api.py           # API contract tests (85 tests)
    ├── test_earnings.py      # Earnings/FIFO tests (16 tests)
    ├── test_market_data.py   # Market data tests (28 tests)
    ├── test_live_mode.py     # Live mode routing tests
    ├── test_risk.py          # Risk scoring tests
    ├── test_signals.py       # Signal classification tests
    ├── test_mt5_integration.py # MT5 broker tests
    ├── test_runtime_config.py  # Config tests
    ├── test_repo_audit.py    # Structural audit tests
    └── ... (15 test files total, 247 tests)
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
