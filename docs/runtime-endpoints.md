# Runtime Endpoints

This document describes the backend endpoints that the frontend depends on for runtime operation.

## Health and Status

### GET /health
**Required** - Source of truth for backend connectivity.

Returns backend health status. If this endpoint succeeds, the frontend considers the backend online.

Minimal response:
```json
{
  "status": "ok",
  "service": "crypto-signal-bot-backend",
  "runtime": "render",
  "mode": "paper",
  "network": "testnet",
  "uptime_seconds": 123
}
```

Extended response (optional fields):
```json
{
  "status": "ok",
  "service": "crypto-signal-bot-backend",
  "runtime": "render",
  "mode": "paper",
  "network": "testnet",
  "uptime_seconds": 123,
  "kill_switch_active": false,
  "kill_switch_reason": null,
  "api_error_count": 0,
  "failed_order_count": 0,
  "halted": false,
  "guardian_triggered": false,
  "market_data_mode": "paper",
  "market_data_connected": false,
  "market_data_source": "health"
}
```

The frontend normalizes minimal responses to include safe defaults for missing fields.

### GET /healthz
Alternative health endpoint for container orchestration.

### GET /ready
Readiness probe endpoint.

## Optional Diagnostic Endpoints

These endpoints are optional. If they fail, the frontend displays a degraded warning but does NOT mark the backend as offline.

### GET /balance
Returns paper/live balance information.

```json
{
  "balances": { "USDT": 10000 },
  "positions": { "BTCUSDT": 0.001 }
}
```

### GET /config
Returns backend configuration.

```json
{
  "trading_mode": "paper",
  "network": "testnet",
  "adapter": "binance_testnet",
  "auth_enabled": true,
  "rate_limit_rpm": 60,
  "paper_use_live_market_data": false
}
```

### GET /exchange/status
Returns exchange connection status.

```json
{
  "trading_mode": "paper",
  "execution_mode": "paper",
  "paper_use_live_market_data": false,
  "exchange": "binance_testnet",
  "market_data_mode": "paper",
  "connected": true,
  "connection_state": "connected",
  "fallback_active": false,
  "last_update_ts": 1234567890,
  "last_error": null,
  "stale": false,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "source": "websocket"
}
```

## Market Data

### GET /prices/batch?symbols=BTCUSDT,ETHUSDT
Returns batch price data.

### GET /price
Returns current price for a symbol.

### GET /price/ohlcv
Returns OHLCV candlestick data.

## Signal and Risk

### GET /signal/latest
Returns the latest trading signal.

### GET /guardian/status
Returns guardian/kill-switch status.

### GET /audit
Returns audit trail entries.

### GET /metrics
Returns system metrics.

## Earnings

### GET /earnings/summary
Returns earnings summary.

### GET /earnings/history
Returns earnings history.

### POST /earnings/reset
Resets earnings data. Requires auth.

## Trading Actions

### POST /market-state
Updates market state.

### POST /intent/paper
Submits a paper trading intent. Requires auth if enabled.

### POST /intent/live
Submits a live trading intent. Requires auth. **Never allowed in demo mode.**

### POST /withdraw
Initiates a withdrawal. Requires auth.

## WebSocket

### WS /ws/updates
Real-time updates WebSocket connection.

Message types:
- `health` - Health updates
- `order_update` - Order status changes
- `guardian_alert` - Guardian alerts
- `kill_switch` - Kill switch state changes
- `market_update` - Market data updates
- `exchange_status` - Exchange connection status

**Note**: WebSocket failure does NOT mark the backend as offline. The frontend falls back to HTTP polling.

## Error Handling

All endpoints should handle:
- `401` - Unauthorized (auth required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `503` - Service unavailable

The frontend gracefully handles these errors:
- For /health: marks backend offline
- For optional endpoints: shows degraded warning, keeps previous data
- For WebSocket: shows WS offline, continues HTTP polling
