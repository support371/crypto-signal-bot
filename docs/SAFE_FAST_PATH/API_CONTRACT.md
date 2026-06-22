# API Contract

## Contract rules

- All responses are versioned.
- Timestamps use ISO 8601 UTC strings and epoch milliseconds where latency math is required.
- Unknown or not-yet-implemented values are `null` or `not_reported`; they are never replaced with invented healthy values.
- Write routes require server-side authentication. No `VITE_*` variable may carry a privileged backend secret.
- Existing public endpoints remain compatible while `/v2` contracts are introduced.

## 1. Infrastructure summary

`GET /v2/infrastructure/status`

```json
{
  "version": "2.0",
  "generated_at": "2026-06-22T12:00:00.000Z",
  "runtime": {
    "trading_mode": "paper",
    "exchange_mode": "paper",
    "network": "testnet",
    "allow_mainnet": false,
    "live_trading_enabled": false,
    "withdrawals_enabled": false
  },
  "guardian": {
    "halted": false,
    "reason": null,
    "drawdown_pct": 0,
    "max_drawdown_pct": 15
  },
  "fast_path": {
    "authority": "legacy_d1",
    "target_authority": "portfolio_durable_object",
    "shadow_mode": false,
    "decision_latency_ms": null,
    "decision_data_age_ms": null,
    "ledger_atomicity_failures": 0
  },
  "feeds": [],
  "projections": {
    "d1_status": "healthy",
    "queue_status": "not_reported",
    "projection_lag_ms": null
  }
}
```

Allowed `fast_path.authority` values:

- `legacy_d1`;
- `shadow_durable_object`;
- `portfolio_durable_object`;
- `not_reported`.

## 2. Feed status

`GET /v2/market/feeds/status`

```json
{
  "version": "2.0",
  "generated_at": "2026-06-22T12:00:00.000Z",
  "feeds": [
    {
      "source": "coinbase",
      "channel": "level2",
      "symbol": "BTC-USD",
      "connection_state": "connected",
      "integrity_state": "healthy",
      "sequence_state": "continuous",
      "heartbeat_state": "healthy",
      "last_sequence": 123456,
      "gap_count": 0,
      "event_age_ms": 42,
      "freshness_class": "green",
      "recovery_state": "idle",
      "last_event_at": "2026-06-22T12:00:00.000Z"
    }
  ]
}
```

Allowed integrity values:

- `healthy`;
- `degraded`;
- `resyncing`;
- `unavailable`;
- `not_reported`.

Allowed freshness values:

- `green`;
- `amber`;
- `red`;
- `not_reported`.

## 3. Decision metrics

`GET /v2/metrics/decision?window=15m`

```json
{
  "window": "15m",
  "sample_count": 0,
  "decision_latency_ms": {
    "p50": null,
    "p95": null,
    "p99": null
  },
  "decision_data_age_ms": {
    "p50": null,
    "p95": null,
    "p99": null
  },
  "duplicate_reject_rate": null,
  "stale_reject_rate": null,
  "ledger_atomicity_failures": 0,
  "queue_projection_lag_ms": null
}
```

## 4. Portfolio summary

`GET /v2/portfolios/:portfolioId/summary`

```json
{
  "portfolio_id": "paper-default",
  "available_cash": 10000,
  "reserved_cash": 0,
  "protected_reserve": 0,
  "realized_pnl": 0,
  "unrealized_pnl": 0,
  "equity": 10000,
  "peak_equity": 10000,
  "drawdown_pct": 0,
  "guardian_halt": false,
  "state_version": 1,
  "updated_at": "2026-06-22T12:00:00.000Z"
}
```

## 5. Simulation intent

`POST /v2/portfolios/:portfolioId/intents/paper`

Required headers:

```text
Authorization: Bearer <server-managed credential>
Idempotency-Key: <deterministic key>
Content-Type: application/json
```

Body:

```json
{
  "version": "2.0",
  "source_event_id": "coinbase:BTC-USD:123456",
  "symbol": "BTC-USD",
  "action": "BUY",
  "quantity": 0.001,
  "requested_notional": 100,
  "execution_policy": "hybrid_v1",
  "market_state": {
    "source": "coinbase",
    "event_age_ms": 42,
    "freshness_class": "green",
    "sequence_ok": true,
    "heartbeat_ok": true,
    "secondary_confirmed": true
  },
  "risk_decision": {
    "approved": true,
    "policy_version": "risk-v1",
    "max_notional": 100,
    "reasons": ["score_threshold_met"]
  },
  "exit_plan": {
    "policy_version": "hybrid-exit-v1",
    "first_reduction_fraction": 0.35,
    "trailing_volatility_multiple": 2,
    "reserve_fraction": 0.25,
    "cooldown_seconds": 120
  }
}
```

Success:

```json
{
  "status": "committed",
  "intent_id": "intent_...",
  "fill_id": "fill_...",
  "idempotent_replay": false,
  "state_version": 2,
  "committed_at": "2026-06-22T12:00:00.000Z"
}
```

Duplicate replay returns the original committed result with `idempotent_replay: true` and does not create another fill.

## 6. Rejection contract

All deterministic rejections use:

```json
{
  "status": "rejected",
  "code": "STALE_MARKET_DATA",
  "message": "New entries require green market data",
  "retryable": false,
  "trace_id": "trace_..."
}
```

Required rejection codes:

- `GUARDIAN_HALTED`;
- `STALE_MARKET_DATA`;
- `SEQUENCE_GAP`;
- `HEARTBEAT_UNHEALTHY`;
- `SECONDARY_CONFIRMATION_REQUIRED`;
- `INSUFFICIENT_REUSABLE_CASH`;
- `INSUFFICIENT_POSITION`;
- `EXPOSURE_LIMIT`;
- `COOLDOWN_ACTIVE`;
- `INVALID_RISK_DECISION`;
- `UNSUPPORTED_ACTION`;
- `IDEMPOTENCY_CONFLICT`.

## 7. Frontend behavior

The frontend infrastructure page reads only status and metric endpoints. It must:

- label current authority as legacy until the backend reports otherwise;
- display heartbeat, sequence, Queue, latency, and reserve capabilities as `not_reported` when absent;
- show paper, testnet, mainnet-disabled, withdrawal-disabled, and guardian state prominently;
- never submit an order from the infrastructure page;
- never include a privileged API key in the browser bundle.
