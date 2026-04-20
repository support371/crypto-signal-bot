# docs/runbooks/mt5_failover.md
# MT5 Integration — Failover Runbook

## MT5 Unavailable Behavior

When the MT5 adapter cannot reach the terminal or the broker session is lost,
the system behaves as follows:

| Surface | Behavior |
|---|---|
| `GET /broker/mt5/health` | Returns `{"terminal_connected": false, "broker_session_ok": false}` |
| `GET /broker/venues` | MT5 shows `"available": false` |
| `POST /intent/live` with `venue=mt5` | Returns HTTP 503 `execution_failed` |
| Exchange routing path | **Unaffected** — exchange adapters route independently |
| Guardian | Receives MT5 order failures via `on_failed_order()` / `on_api_error()` |

---

## Reconnect Behavior

The `MT5BridgeService` runs a background reconnect monitor polling every
`reconnect_interval_seconds` (default: 5s):

```
Bridge detects session loss
  → marks MT5 unavailable in venue_registry
  → publishes broker_health event to Redis/WebSocket
  → attempts adapter.connect()
    → on success: marks MT5 available, resumes normal routing
    → on failure: logs, waits interval, retries indefinitely
```

**Reconnects are transparent to the execution engine.** Intents arriving during
the reconnect window are rejected with 503 if MT5 is the selected venue.
Exchange routes are unaffected.

---

## Guardian Interaction

MT5 failures feed the guardian's threshold counters through the existing
execution coordinator path:

```
MT5 submit_order() raises BrokerOrderError
  → coordinator.execute_intent() catches ExecutionRejected
  → calls guardian.on_failed_order()
  → guardian._failed_order_count += 1
  → if count >= max_failed_orders: activate_kill_switch()

MT5 submit_order() raises BrokerUnavailableError (all retries)
  → coordinator catches ExecutionFailed
  → calls guardian.on_api_error()
  → guardian._api_error_count += 1
  → if count >= max_api_errors: activate_kill_switch()
```

The kill switch is activated on MT5 threshold breach the same way it is for
exchange adapter failures. Risk always overrides.

---

## Execution Blocking

When the kill switch is active (regardless of trigger source):

```
coordinator.execute_intent()
  → is_kill_switch_active() == True
  → raises KillSwitchActive
  → HTTP 503 returned to all intent routes
  → audit entry written
  → NO order submitted to any venue (MT5 or exchange)
```

MT5 being unavailable does NOT automatically activate the kill switch.
Only threshold breaches (failed orders, API errors, drawdown) do.

---

## Recovery Steps

### Scenario 1: MT5 terminal crashed

```bash
1. Restart MetaTrader 5 terminal on the VPS/machine
2. Wait 5-10s for the bridge reconnect loop to pick it up
3. Verify: GET /broker/mt5/health → terminal_connected: true
4. If kill switch was activated: POST /kill-switch {"activate": false}
```

### Scenario 2: Broker session expired

```bash
1. The reconnect loop re-logs in automatically
2. Verify: GET /broker/mt5/health → broker_session_ok: true
3. No manual action needed unless kill switch fired
```

### Scenario 3: Symbol mapping failure

```bash
1. GET /broker/mt5/symbols — check what symbols are available
2. Update config/mt5.yaml symbol_map to match broker's naming
3. Restart backend (symbol map is loaded once at startup)
4. Re-verify: GET /broker/mt5/symbols
```

### Scenario 4: Kill switch was activated by MT5 failures

```bash
# 1. Verify MT5 is reconnected
curl http://localhost:8000/broker/mt5/health

# 2. Reset guardian error counters (admin action — no route yet; restart clears them)
# Or implement POST /guardian/reset-counters in Phase N+1

# 3. Deactivate kill switch
curl -X POST http://localhost:8000/kill-switch \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"activate": false, "reason": "MT5 reconnected, counters reset"}'

# 4. Verify
curl http://localhost:8000/guardian/status
# → kill_switch_active: false, heartbeat_healthy: true
```

---

## Metrics to Monitor

| Metric | Alert Threshold | Action |
|---|---|---|
| `mt5_connected` | = 0 for > 30s | Check terminal, check VPS |
| `mt5_order_failures_total` | > 3 in 5 min | Investigate fill rejections |
| `mt5_reconnects_total` | > 5 in 1 hour | Investigate network stability |
| `mt5_latency_ms` | > 500ms | Check broker server latency |

These metrics are available at `GET /metrics` (Prometheus format).

---

## MT5-Specific Broker Errors

| Error | Retcode | Cause | Recovery |
|---|---|---|---|
| `TRADE_RETCODE_REJECT` | 10006 | Order parameters invalid | Check volume_min, price step |
| `TRADE_RETCODE_MARKET_CLOSED` | 10018 | Market is closed | Wait for market open |
| `TRADE_RETCODE_NO_MONEY` | 10019 | Insufficient margin | Reduce position size |
| `TRADE_RETCODE_PRICE_CHANGED` | 10004 | Price moved during submission | Increase deviation, retry |
| `TRADE_RETCODE_CONNECTION` | 10005 | No connection to server | Wait for reconnect loop |
| `TRADE_RETCODE_TRADE_DISABLED` | 10017 | Trading disabled on account | Contact broker |

Reference: [MetaQuotes ENUM_TRADE_RETCODE documentation](https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_retcode)
