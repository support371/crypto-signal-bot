# Decision Trace Specification

> Defines the structured trace format for every trading decision.

## Purpose

Every trading decision — from signal detection through risk evaluation to execution — must emit a structured trace. Traces enable:

1. **Auditability**: Replay any decision to understand why it was made.
2. **Determinism verification**: Same inputs must produce the same decision.
3. **Debugging**: Pinpoint where a decision diverged from expectations.

## Trace Schema

```typescript
interface DecisionTrace {
  // Identity
  trace_id: string;           // UUID, unique per decision
  intent_id: string;          // Links to ExecutionIntent.id
  timestamp: number;          // Unix epoch (seconds)

  // Input context
  symbol: string;             // e.g. "BTCUSDT"
  side: "BUY" | "SELL";
  quantity: float;            // Requested quantity
  price: float;               // Price at decision time
  mode: "paper" | "live";

  // Signal stage
  signal: {
    regime: "TREND" | "RANGE" | "CHAOS";
    direction: "UP" | "DOWN" | "NEUTRAL";
    confidence: float;        // 0.0 - 1.0
    features: {
      spread_pct: float;
      imbalance: float;
      mid_vel: float;
      depth_decay: float;
      vol_spike: boolean;
      short_reversal: boolean;
    };
  };

  // Risk stage
  risk: {
    score: float;             // 0.0 - 1.0 (higher = riskier)
    rules_evaluated: RuleTrace[];
    approved: boolean;
    combined_size_multiplier: float;
    adjusted_quantity: float;  // After size multiplier
    rejection_reasons: string[];
  };

  // Execution stage
  execution: {
    status: "FILLED" | "RISK_REJECTED" | "FAILED" | "CANCELLED";
    fill_price: float | null;
    fill_quantity: float | null;
    slippage_pct: float | null;
    adapter: "paper" | "binance" | "bitget" | "btcc";
    notes: string | null;
  };

  // Guardian state at decision time
  guardian: {
    kill_switch_active: boolean;
    kill_switch_reason: string | null;
    guardian_triggered: boolean;
    drawdown_pct: float;
    api_error_count: number;
    failed_order_count: number;
  };
}

interface RuleTrace {
  rule_name: string;          // e.g. "MaxPosition", "PortfolioExposure"
  passed: boolean;
  reason: string;
  size_multiplier: float;
}
```

## Current Implementation Status

### What exists today

The current system emits partial traces:

- **Intent processing** (`_process_intent()` in `app.py`): Creates `ExecutionIntent` with id, status, notes. Appends to audit store.
- **Risk evaluation** (`RiskRuleEngine.evaluate()`): Returns `RiskEngineResult` with per-rule results, combined multiplier, approval status.
- **Audit store** (`logic/audit_store.py`): Persists intent dicts as JSON. Accessible via `/audit` endpoint.
- **Risk events**: Appended separately via `append_risk_event()`.

### What's missing for full trace

1. **Signal stage**: Signal classification results are not attached to intent traces. The signal is computed in `build_market_state_result()` but not linked to the execution path.
2. **Unified trace object**: Currently intent, risk event, and audit entry are separate records. They should be unified into a single `DecisionTrace`.
3. **Guardian snapshot**: Guardian state at decision time is not captured in the trace.
4. **Persistence**: Traces are in-memory. Need database persistence for replay.

## Implementation Roadmap

1. Create `backend/models/decision_trace.py` with the Pydantic model above.
2. Modify `_process_intent()` to construct a `DecisionTrace` at each stage.
3. Add `GET /trace/{intent_id}` endpoint to retrieve full traces.
4. Add `GET /traces` with filtering by symbol, status, time range.
5. Persist traces to the database alongside existing audit entries.

## Determinism Contract

For a decision to be deterministic:

- **Inputs**: symbol, side, quantity, price, portfolio state, risk config, guardian state
- **Processing**: feature extraction → signal classification → risk evaluation → fill simulation
- **Output**: Same inputs must produce the same `DecisionTrace`

The only non-deterministic element is the synthetic price generator (`_synthetic_price()`), which uses `random.gauss()`. For replay testing, seed the RNG or provide explicit prices.
