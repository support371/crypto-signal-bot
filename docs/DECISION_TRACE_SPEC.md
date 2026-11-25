# Decision Trace Specification

> Defines the structured trace format for every trading decision.
> Last verified against implementation: November 2026.

## Purpose

Every trading decision — from signal detection through risk evaluation to execution — emits a structured trace. Traces enable:

1. **Auditability**: Replay any decision to understand why it was made.
2. **Determinism verification**: Same inputs must produce the same decision.
3. **Debugging**: Pinpoint where a decision diverged from expectations.

## Implementation Overview

The system has **two complementary tracing subsystems**:

| Subsystem | Module | Scope | Storage |
|-----------|--------|-------|---------|
| **DecisionTrace** (Pydantic) | `backend/models/decision_trace.py` | Structured per-intent traces with signal, risk, execution and guardian snapshots | JSON file via `backend/audit/store.py` |
| **DecisionTracer** (ring buffer) | `backend/audit/tracer.py` | Signal executor decisions (BUY/SELL/CLOSE/HOLD) with config snapshots | In-memory deque, bounded by `trace_max_entries` setting |

Both are populated during the intent processing pipeline in `app.py`.

---

## DecisionTrace Model

Defined in `backend/models/decision_trace.py` as Pydantic v2 models. Serialized via `.to_dict()` → `.model_dump()`.

```python
class DecisionTrace(BaseModel):
    # Identity
    trace_id: str           # UUID, auto-generated
    intent_id: str          # Links to ExecutionIntent.id
    timestamp: float        # Unix epoch (seconds), auto-generated

    # Input context
    symbol: str             # e.g. "BTCUSDT"
    side: str               # "BUY" | "SELL"
    quantity: float         # Requested quantity
    price: float            # Price at decision time
    mode: str               # "paper" | "live"

    # Nested snapshots
    signal: SignalSnapshot
    risk: RiskSnapshot
    execution: ExecutionSnapshot
    guardian: GuardianSnapshot
```

### SignalSnapshot

```python
class SignalSnapshot(BaseModel):
    regime: str = "UNKNOWN"       # "TREND" | "RANGE" | "CHAOS" | "UNKNOWN"
    direction: str = "NEUTRAL"    # "UP" | "DOWN" | "NEUTRAL"
    confidence: float = 0.0       # 0.0 – 1.0
    horizon_minutes: int = 0      # Signal evaluation horizon
```

### RiskSnapshot

```python
class RiskSnapshot(BaseModel):
    score: float = 0.0                        # 0.0 – 1.0 (higher = riskier)
    rules_evaluated: list[RuleTrace] = []     # Per-rule results
    approved: bool = False
    combined_size_multiplier: float = 1.0
    adjusted_quantity: float | None = None    # After size multiplier
    rejection_reasons: list[str] = []
```

### RuleTrace

```python
class RuleTrace(BaseModel):
    rule_name: str            # e.g. "MaxPosition", "PortfolioExposure"
    passed: bool
    reason: str
    size_multiplier: float = 1.0
```

### ExecutionSnapshot

```python
class ExecutionSnapshot(BaseModel):
    status: str = "PENDING"               # "FILLED" | "RISK_REJECTED" | "FAILED" | "CANCELLED" | "PENDING"
    fill_price: float | None = None
    fill_quantity: float | None = None
    slippage_pct: float | None = None
    adapter: str = "paper"                # "paper" | "binance" | "bitget" | "btcc"
    notes: str | None = None
```

### GuardianSnapshot

```python
class GuardianSnapshot(BaseModel):
    kill_switch_active: bool = False
    kill_switch_reason: str | None = None
    guardian_triggered: bool = False
    drawdown_pct: float = 0.0
    api_error_count: int = 0
    failed_order_count: int = 0
```

---

## DecisionTracer (Ring Buffer)

Defined in `backend/audit/tracer.py`. Singleton instance: `decision_tracer`.

Records every signal executor decision including **HOLD** decisions (why the system did NOT trade). Uses an in-memory `deque` bounded by `settings.trace_max_entries`.

### TraceEntry Fields

| Field | Type | Description |
|-------|------|-------------|
| `trace_id` | str | UUID |
| `timestamp` | float | Unix epoch |
| `symbol` | str | e.g. "BTCUSDT" |
| `decision` | str | "BUY" / "SELL" / "CLOSE" / "HOLD" |
| `side` | str \| None | "BUY" / "SELL" / None (for HOLD/CLOSE) |
| `confidence` | float | Signal confidence |
| `strategy_id` | str | Which strategy produced the signal |
| `signal_side` | str | Raw signal direction from engine |
| `equity` | float | Account equity at decision time |
| `notional` | float | Position notional value |
| `mode` | str | "paper" / "live" |
| `hold_reasons` | list[HoldReason] | Structured reasons for HOLD decisions |
| `fill_price` | float \| None | Execution fill price |
| `fill_quantity` | float \| None | Filled quantity |
| `fill_status` | str \| None | Fill result status |
| `fill_error` | str \| None | Error message if execution failed |
| `config_snapshot_hash` | str \| None | Hash of config at decision time |
| `min_confidence_threshold` | float | Config: minimum confidence to trade |
| `max_positions` | int | Config: max concurrent positions |
| `position_pct` | float | Config: position size as fraction of equity |

### HoldReason

```python
@dataclass
class HoldReason:
    code: str           # e.g. "LOW_CONFIDENCE", "MAX_POSITIONS", "GUARDIAN_TRIGGERED"
    description: str
    threshold: float | None = None
    actual: float | None = None
```

### Tracer API

| Method | Description |
|--------|-------------|
| `record(entry)` | Append a TraceEntry to the ring buffer |
| `get_recent(n=50)` | Last n traces (newest first) as dicts |
| `get_for_symbol(symbol, n=50)` | Traces filtered by symbol |
| `get_hold_traces(n=50)` | HOLD decisions only |
| `get_stats()` | Aggregate counts: total, buy, sell, close, hold, hold_pct, hold_reason_breakdown |
| `flush()` | Clear all traces (testing only) |
| `make_entry(**kwargs)` | Factory that reads current settings for config fields |

---

## ExecutionIntent Model

Defined in `backend/models/execution_intent.py`. Pydantic v2 `BaseModel`.

```python
class ExecutionIntent(BaseModel):
    id: str                        # UUID, auto-generated
    symbol: str
    side: Side                     # Enum: BUY | SELL
    order_type: OrderType          # Enum: MARKET | LIMIT
    quantity: float
    price: float | None
    time_in_force: TimeInForce     # Enum: GTC | IOC | FOK
    status: IntentStatus           # Enum: see state machine
    notes: str | None
    created_at: float              # Unix epoch
    updated_at: float              # Unix epoch
    fill_price: float | None
    fill_quantity: float | None
    mode: str                      # "paper" | "live"
    strategy_id: str | None
    venue_id: str | None
```

---

## Intent State Machine

Defined in `backend/engine/state_machine.py`. Enforces valid transitions; raises `StateTransitionError` on invalid ones.

```
PENDING ──→ RISK_APPROVED ──→ SUBMITTED ──→ FILLED          (terminal)
   │              │                │
   │              │                ├──→ PARTIALLY_FILLED ──→ FILLED
   │              │                │                    ├──→ CANCELLED
   │              │                │                    └──→ FAILED
   │              │                ├──→ CANCELLED        (terminal)
   │              │                └──→ FAILED           (terminal)
   │              └──→ FAILED
   │
   └──→ RISK_REJECTED                                   (terminal)
```

**Terminal states** (no further transitions): `FILLED`, `CANCELLED`, `FAILED`, `RISK_REJECTED`.

The `transition()` function mutates the intent in place, updates `updated_at`, and optionally sets `notes`, `fill_price`, and `fill_quantity`.

---

## API Endpoints

### Structured DecisionTrace endpoints (audit_v1)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/traces` | GET | Recent structured traces. Params: `symbol`, `status`, `limit` (default 50) |
| `/trace/{intent_id}` | GET | Single trace by intent ID. Returns 404 if not found. |

### Ring-buffer decision endpoints (decisions_v1)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/decisions` | GET | Recent executor decisions. Param: `n` (default 50, max 500) |
| `/api/v1/decisions/holds` | GET | HOLD decisions only with structured reasons |
| `/api/v1/decisions/stats` | GET | Aggregate counts: buy/sell/close/hold breakdown |
| `/api/v1/decisions/{symbol}` | GET | Decisions filtered by symbol |

---

## Persistence

### DecisionTrace storage (`backend/audit/store.py`)

- Traces are appended via `append_trace(trace_data)` to a JSON file.
- Each trace is also copied to the event log via `_copy_to_event_log("audit.trace", ...)`.
- Retrieval: `get_traces(symbol, status, limit)` and `get_trace_by_intent_id(intent_id)`.
- Thread-safe via `threading.Lock`.

### DecisionTracer storage

- In-memory `deque(maxlen=trace_max_entries)` on the singleton `decision_tracer`.
- Not persisted across restarts. Suitable for operational dashboards and debugging.

---

## Determinism Contract

For a decision to be deterministic:

- **Inputs**: symbol, side, quantity, price, portfolio state, risk config, guardian state
- **Processing**: feature extraction → signal classification → risk evaluation → fill simulation
- **Output**: Same inputs must produce the same `DecisionTrace`

The paper adapter uses deterministic fill simulation (fills at requested price). The only non-deterministic element is the synthetic price generator for simulation mode, which uses `math.sin()` oscillations (deterministic given the same timestamp).

---

## Test Coverage

Decision trace tests are in `backend/tests/test_decision_trace.py` (7 tests):

1. **Model tests**: Default construction, full construction with all nested snapshots, serialization roundtrip.
2. **API tests**: Empty traces endpoint, trace creation on paper buy, trace lookup by intent ID, 404 for missing trace, symbol filtering, risk rules capture, guardian state capture.
