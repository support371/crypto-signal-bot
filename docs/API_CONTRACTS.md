# API Contracts

> Canonical reference for all backend API endpoints. Updated as of PR #75.

## Authentication

Two auth mechanisms:

1. **API Key** (`X-API-Key` header): Required for write endpoints when `BACKEND_API_KEY` is set. When not set, all endpoints are open (dev mode).
2. **Rate Limiting**: Per-IP, 120 requests/minute default. Applied via `Depends(rate_limit.rate_limit)`.

## Endpoints

### Health & Status

#### `GET /health` (also `/healthz`, `/api/health`)
No auth. No rate limit.

```json
{
  "status": "ok",
  "service": "crypto-signal-bot-backend",
  "runtime": "asgi" | "render",
  "mode": "paper" | "live",
  "network": "testnet" | "mainnet",
  "adapter": "paper" | "binance" | "bitget" | "btcc",
  "kill_switch_active": false,
  "halted": false,
  "guardian_triggered": false,
  "market_data_mode": "synthetic_paper" | "live_public_paper" | "execution_only",
  "market_data_connected": false,
  "market_data_source": "synthetic" | "binance-public" | "bitget-public",
  "uptime_seconds": 123.456
}
```

#### `GET /ready`
No auth. No rate limit. Readiness check with diagnostics (no secrets exposed).

#### `GET /exchange/status`
Rate limited.

```json
{
  "trading_mode": "paper",
  "execution_mode": "paper",
  "market_data_mode": "synthetic_paper",
  "paper_use_live_market_data": false,
  "exchange": null,
  "connected": false,
  "connection_state": "disabled",
  "fallback_active": false,
  "stale": true,
  "symbols": [],
  "source": "synthetic",
  "last_update_ts": null,
  "last_error": null
}
```

#### `GET /config`
Rate limited. Exposes runtime configuration (no secrets).

```json
{
  "trading_mode": "paper",
  "network": "testnet",
  "exchange": "binance",
  "adapter_mode": "paper",
  "adapter_exchange": "binance",
  "market_data_public_exchange": "binance",
  "paper_use_live_market_data": false,
  "config_path": "backend/config/config.yaml",
  "cors_origins": ["..."],
  "risk_config": {
    "max_position_pct": 0.05,
    "max_daily_loss_pct": 0.03,
    "volatility_threshold": 0.08,
    "max_leverage": 1.0,
    "max_slippage_pct": 0.005
  }
}
```

### Portfolio & Trading

#### `GET /balance`
Rate limited.

```json
{
  "balances": { "USDT": "10000.0" },
  "positions": []
}
```

Note: Balance values are returned as **strings**. Cast to float for numeric operations.

#### `GET /positions`
Rate limited.

```json
{
  "positions": []
}
```

#### `GET /orders`
Rate limited. Optional query: `?symbol=BTCUSDT`

```json
{
  "orders": [
    {
      "id": "uuid",
      "symbol": "BTCUSDT",
      "side": "BUY",
      "order_type": "MARKET",
      "quantity": 0.01,
      "price": null,
      "status": "FILLED",
      "created_at": 1700000000.0
    }
  ]
}
```

#### `POST /intent/paper`
Auth required (when `BACKEND_API_KEY` set).

Request:
```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "order_type": "MARKET",
  "quantity": 0.01,
  "price": null
}
```

Response:
```json
{
  "id": "uuid",
  "status": "FILLED" | "RISK_REJECTED" | "FAILED",
  "notes": "Paper fill at 43000.00 (slippage: 0.014%)"
}
```

#### `POST /intent/live`
Auth required. Blocked when kill-switch is active (returns 503).

Same request/response schema as `/intent/paper`.

### Market Data

#### `GET /price`
Rate limited. Optional query: `?symbol=BTCUSDT` (defaults to BTCUSDT).

**Paper mode (synthetic):**
```json
{
  "symbol": "BTCUSDT",
  "price": 43017.035,
  "change24h": 0.0,
  "volume24h": 0.0,
  "marketCap": 0.0,
  "timestamp": 1700000000.0,
  "source": "synthetic",
  "exchange": null,
  "market_data_mode": "synthetic_paper"
}
```

**Error responses:**
- `404` — `{"error": "symbol_not_tracked", "symbol": "XYZUSDT"}` (hybrid mode, symbol not in tracked list)
- `503` — `{"error": "market_data_unavailable", "symbol": "BTCUSDT"}` (hybrid mode, feed down)
- `503` — `{"error": "execution_unavailable", "symbol": "BTCUSDT"}` (live mode, adapter not connected)

#### `GET /signal/latest`
Rate limited. Optional query: `?symbol=BTCUSDT`

Returns the most recent signal classification for the given symbol (or latest overall if no symbol specified).

#### `POST /market-state`
Auth required.

Request:
```json
{
  "symbol": "BTCUSDT",
  "price": 43000.0,
  "change24h": 2.5,
  "volume24h": 1000000.0,
  "marketCap": 800000000000.0
}
```

Returns signal classification result. Also caches the result and broadcasts via WebSocket.

### Kill-Switch & Guardian

#### `POST /kill-switch`
Operator key required (when `BACKEND_API_KEY` set, requires `X-API-Key` header).

Request:
```json
{
  "activate": true,
  "reason": "manual halt"
}
```

Response:
```json
{
  "kill_switch_active": true,
  "action": "activated",
  "reason": "manual halt",
  "kill_switch_reason": "manual halt",
  "audit_id": "audit-1700000000-1"
}
```

#### `POST /kill-switch/scope`
Operator key required.

Request:
```json
{
  "activate": true,
  "scope_type": "strategy",
  "scope_id": "momentum-v1",
  "reason": "pausing strategy"
}
```

#### `GET /guardian/status`
Rate limited.

```json
{
  "triggered": false,
  "trigger_reason": null,
  "trigger_ts": null,
  "kill_switch_active": false,
  "kill_switch_reason": null,
  "drawdown_pct": 0.0,
  "api_error_count": 0,
  "failed_order_count": 0,
  "thresholds": {
    "max_api_errors": 5,
    "max_failed_orders": 3,
    "max_drawdown_pct": 3.0
  },
  "market_data": { "..." }
}
```

### Reconciliation

#### `GET /reconciliation/status`
Rate limited.

```json
{
  "status": "ok",
  "report": {
    "usdt_balance": 10000.0,
    "realized_pnl": 0.0,
    "lot_count": 0,
    "trade_count": 0,
    "timestamp": 1700000000.0
  }
}
```

Returns `{"status": "no_report"}` if reconciliation has not run yet.

### Earnings

#### `GET /earnings/summary`
Rate limited. Returns P&L summary.

#### `GET /earnings/history`
Rate limited. Optional query: `?symbol=BTCUSDT&limit=100`

```json
{
  "trades": [...]
}
```

#### `POST /earnings/reset`
Auth required. Clears the earnings ledger.

### Audit

#### `GET /audit`
Rate limited. Returns the full audit trail.

### WebSocket

#### `WS /ws/updates`
Streams real-time updates. Messages include a `type` field:

- `health` — Initial snapshot on connect
- `kill_switch` — Kill-switch state change
- `market_update` — Price/signal update for a symbol
- `exchange_status` — Market data connection state change

### Metrics

#### `GET /metrics`
Returns Prometheus-format metrics (if `prometheus_client` is installed).

### Utility

#### `POST /withdraw`
Auth required. Paper withdrawal simulation.

#### `POST /analyze`
Auth required. Feature extraction + signal classification.

#### `POST /simulate`
Auth required. Multi-step simulation.
