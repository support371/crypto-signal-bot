# API Contracts

> Canonical reference for all backend API endpoints. Updated November 2026.

## Authentication

**API Key** (`X-API-Key` header): Required for write endpoints when `BACKEND_API_KEY` is set. When not set, all endpoints are open (dev/paper mode). Auth-required endpoints are marked below with **Auth**.

## Core Endpoints

These are the primary endpoints used by the frontend dashboard and external integrations.

### Health & Status

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Primary health check |
| GET | `/healthz` | No | Alias for `/health` |
| GET | `/api/health` | No | Alias for `/health` |
| GET | `/ready` | No | Readiness probe with diagnostics |
| GET | `/ping` | No | Simple liveness check |
| GET | `/version` | No | Backend version info |

#### `GET /health` response

```json
{
  "status": "ok",
  "service": "crypto-signal-bot-backend",
  "runtime": "asgi",
  "mode": "paper",
  "network": "testnet",
  "adapter": "paper",
  "kill_switch_active": false,
  "halted": false,
  "guardian_triggered": false,
  "market_data_mode": "live_public_paper",
  "market_data_connected": false,
  "market_data_source": "coingecko-rest",
  "uptime_seconds": 123.456
}
```

### Configuration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/config` | No | Runtime configuration (no secrets) |
| GET | `/config/snapshot` | No | Full config snapshot |
| GET | `/runtime/status` | No | Runtime status |
| GET | `/mainnet-gate/status` | No | Mainnet gate status |

### Market Data

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/price` | No | Current price. Query: `?symbol=BTCUSDT` |
| GET | `/signal/latest` | No | Latest signal classification. Query: `?symbol=BTCUSDT` |
| POST | `/market-state` | **Auth** | Submit market state for signal classification |
| GET | `/exchange/status` | No | Exchange connectivity status |
| GET | `/exchange/supported` | No | Supported exchange list |
| GET | `/exchange/circuit-breakers` | No | Circuit breaker statuses |
| GET | `/exchange/validate` | No | Exchange validation |
| POST | `/exchange/test-connection` | No | Test exchange connection |
| GET | `/market/feed/status` | No | Market feed status |
| GET | `/surge/status` | No | Surge scanner status |

#### `GET /price` response

```json
{
  "symbol": "BTCUSDT",
  "price": 68000.0,
  "change24h": 2.5,
  "volume24h": 1000000.0,
  "marketCap": 800000000000.0,
  "timestamp": 1700000000.0,
  "source": "coingecko-rest",
  "market_data_mode": "live_public_paper"
}
```

Error responses: `404` (symbol not tracked), `503` (market data unavailable).

#### `GET /signal/latest` response

```json
{
  "available": true,
  "signal": {
    "symbol": "BTCUSDT",
    "direction": "UP",
    "confidence": 0.85,
    "regime": "TREND",
    "strategy_id": "momentum-v1"
  }
}
```

When unavailable: `{"available": false, "message": "No signal cached"}`.

### Portfolio & Trading

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/balance` | No | Account balances and positions |
| GET | `/positions` | No | Open positions |
| GET | `/orders` | No | Order history. Query: `?symbol=BTCUSDT` |
| POST | `/intent/paper` | **Auth** | Submit paper trade intent |
| POST | `/intent/live` | **Auth** | Submit live trade intent (blocked by kill switch) |
| POST | `/withdraw` | **Auth** | Paper withdrawal simulation |

#### `GET /balance` response

```json
{
  "balances": { "USDT": "10000.0" },
  "positions": []
}
```

Note: Balance values are strings. Cast to float for numeric operations.

#### `POST /intent/paper` request / response

Request:
```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "order_type": "MARKET",
  "quantity": 0.01,
  "price": null,
  "idempotency_key": "optional-unique-key"
}
```

The `idempotency_key` field is optional. When provided, duplicate requests with the same key return the original intent's ID with status `DUPLICATE_REJECTED` instead of executing again.

Response:
```json
{
  "id": "uuid",
  "status": "FILLED",
  "notes": "Paper fill at 68000.00 (slippage: 0.014%)"
}
```

Status values: `FILLED`, `RISK_REJECTED`, `FAILED`, `DUPLICATE_REJECTED`.

### Kill-Switch & Guardian

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/kill-switch` | **Auth** | Toggle global kill switch |
| POST | `/kill-switch/scope` | **Auth** | Toggle scoped kill switch (strategy/venue) |
| GET | `/guardian/status` | No | Guardian status and thresholds |

#### `GET /guardian/status` response

```json
{
  "kill_switch_active": false,
  "triggered": false,
  "kill_switch_reason": null,
  "trigger_reason": null,
  "drawdown_pct": 0.0,
  "daily_loss_pct": 0.0,
  "api_error_count": 0,
  "failed_order_count": 0,
  "thresholds": {
    "max_drawdown_pct": 3.0,
    "max_daily_loss_pct": 5.0,
    "max_api_errors": 5,
    "max_failed_orders": 3
  },
  "market_data": { "..." }
}
```

### Audit & Traces

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/audit` | No | Full audit trail |
| GET | `/traces` | No | Decision traces. Query: `?symbol=&status=&limit=50` |
| GET | `/trace/{intent_id}` | No | Single trace by intent ID |
| GET | `/metrics` | No | Prometheus-format metrics |

#### `GET /traces` response

```json
[
  {
    "trace_id": "uuid",
    "intent_id": "uuid",
    "timestamp": 1700000000.0,
    "symbol": "BTCUSDT",
    "side": "BUY",
    "quantity": 0.001,
    "price": 68000.0,
    "mode": "paper",
    "signal": {
      "regime": "TREND",
      "direction": "UP",
      "confidence": 0.85
    },
    "risk": {
      "score": 0.0,
      "rules_evaluated": [
        {"rule_name": "MaxPosition", "passed": true, "reason": "Within limits", "size_multiplier": 1.0}
      ],
      "approved": true
    },
    "execution": {
      "status": "FILLED",
      "fill_price": 68010.0,
      "adapter": "paper"
    },
    "guardian": {
      "kill_switch_active": false,
      "drawdown_pct": 0.0
    }
  }
]
```

### Reconciliation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reconciliation/status` | No | Reconciliation report |
| GET | `/reconciliation/exchange` | No | Exchange reconciliation |

### Earnings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/earnings/summary` | No | P&L summary |
| GET | `/earnings/history` | No | Trade history. Query: `?symbol=&limit=100` |
| POST | `/earnings/reset` | **Auth** | Clear earnings ledger |

### Analysis

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/analyze-features` | **Auth** | Feature extraction + signal classification |
| POST | `/simulate-session` | **Auth** | Multi-step simulation |

---

## V1 API Routes

Versioned API routes under `/api/v1/`. These are mounted via routers and serve the richer operational interface.

> **Note**: Several routers have a double-prefix issue (e.g., `/api/v1/console/api/v1/console/...`). The frontend uses the actual resolved paths. This is documented as-is until the router mounting is cleaned up in Phase 1.1.

### Signals (`/api/v1/signals/...`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../public` | Public signal data |
| GET | `.../status` | Signal engine status |
| GET | `.../{symbol}` | Signal for specific symbol |
| POST | `.../evaluate` | Force re-evaluate a symbol |

### Portfolio (`/api/v1/.../portfolio`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../portfolio` | Portfolio summary |
| GET | `.../portfolio/trades` | Trade history |
| GET | `.../portfolio/positions` | Position details |
| GET | `.../portfolio/pnl/daily` | Daily P&L |
| GET | `.../portfolio/equity-history` | Equity curve |
| POST | `.../portfolio/reset` | Reset portfolio |

### Guardian (`/api/v1/.../guardian`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../guardian/status` | Guardian status (v1) |
| POST | `.../guardian/reset` | Reset guardian counters |
| GET | `.../guardian/thresholds` | Current thresholds |
| POST | `.../guardian/set-nav` | Set NAV baseline |

### Console (`/api/v1/console/...`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../status` | Console status |
| GET | `.../audit` | Console audit log |
| POST | `.../trade` | Submit trade via console |
| POST | `.../signal-override` | Set signal override |
| DELETE | `.../signal-override/{symbol}` | Cancel signal override |
| POST | `.../signal-reeval` | Force signal re-evaluation |
| POST | `.../kill-switch` | Toggle kill switch via console |
| POST | `.../guardian/reset` | Reset guardian via console |
| POST | `.../portfolio/reset` | Reset portfolio via console |
| POST | `.../positions/close` | Close position |
| POST | `.../positions/close-all` | Close all positions |
| POST | `.../positions/cancel-order` | Cancel order |
| GET/POST | `.../guardian/thresholds` | Get/update thresholds |

### Decisions (`/api/v1/decisions/...`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../decisions` | Recent decisions |
| GET | `.../decisions/holds` | HOLD decisions |
| GET | `.../decisions/stats` | Decision statistics |
| GET | `.../decisions/{symbol}` | Decisions for symbol |

### Monitoring (`/api/v1/monitor/...`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../status` | Monitor status |
| GET | `.../probes` | Available probes |
| POST | `.../run` | Run probes now |
| GET | `.../ingestion` | Ingestion telemetry |
| GET | `.../ingestion/{symbol}` | Symbol ingestion telemetry |
| POST | `.../ingestion/symbols` | Reconfigure symbols |

### Backtest & Replay

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../backtest/strategies` | Available strategies |
| POST | `.../backtest` | Run backtest |
| POST | `.../backtest/compare` | Compare strategies |
| POST | `.../backtest/live` | Live backtest |
| POST | `.../replay` | Run replay |
| GET | `.../replay/strategies` | Replay strategies |

### Orders (`/api/v1/.../orders`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../orders` | List orders |
| POST | `.../orders` | Create order |
| GET | `.../orders/{order_id}` | Get order by ID |

### Risk

| Method | Path | Description |
|--------|------|-------------|
| POST | `.../risk/evaluate` | Evaluate risk for intent |

---

## WebSocket Endpoints

| Path | Description |
|------|-------------|
| `/ws/updates` | Primary real-time update stream |
| `/ws` | Alias WebSocket endpoint |
| `/stream` | Streaming endpoint |
| `/stream/latest` | GET — latest stream snapshot |

### WebSocket message types

All messages include a `type` field:

| Type | Direction | Description |
|------|-----------|-------------|
| `status` | Server → Client | Connection status on connect |
| `ping` | Server → Client | Heartbeat (every 10s) |
| `ticker` | Server → Client | Price ticker update |
| `health` | Server → Client | Health state change |
| `kill_switch` | Server → Client | Kill-switch state change |
| `market_update` | Server → Client | Price/signal update for a symbol |
| `exchange_status` | Server → Client | Market data connection state change |
| `order_update` | Server → Client | Order fill/status change |
| `guardian_alert` | Server → Client | Guardian threshold breach |

---

## Safe-Mode Behavior

Per CLAUDE.md safety constraints:

- **Paper mode**: All endpoints return real simulated data, not fabricated success values
- **Kill switch**: When active, `POST /intent/live` returns 503; `POST /intent/paper` still works
- **No withdrawal execution**: `/withdraw` performs paper simulation only
- **Missing live data**: Returns typed error responses, never silent fabrication
