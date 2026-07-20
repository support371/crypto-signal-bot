# Certification Mode

## Purpose

Certification Mode is the operator-facing name for the platform's isolated,
non-funding trading rehearsal environment. It is designed to exercise the same
market-data, signal, risk, accounting, reconciliation, recovery, Guardian, and
audit boundaries required for future real-money trading without granting an
exchange-mutation capability.

## Compatibility boundary

The deployed Worker still reports `mode=paper`, `TRADING_MODE=paper`, and uses
the legacy `/intent/paper` route. Those identifiers are retained temporarily as
a backwards-compatible safety lock. They do not define the product language and
must not be changed until a versioned API and separately reviewed deployment
migration are ready.

The dashboard displays **Certification Mode**. The `/agent/context` source now
also reports:

- `display_mode=certification`;
- `certification_mode=true`;
- `provider_mutation_enabled=false`;
- `real_funds_enabled=false`.

## Real-market signal rehearsal

The source-only certification signal engine uses Bitget's official public spot
candlestick endpoint:

`GET https://api.bitget.com/api/v2/spot/market/candles`

The current contract:

- requests at most 100 five-minute candles;
- evaluates closed candles only;
- uses no credential or private header;
- bounds request duration and response bytes;
- rejects malformed, incomplete, duplicate, stale, or tampered evidence;
- calculates deterministic EMA12, EMA26, RSI14, and a clearly labeled
  candle-direction volume proxy;
- hashes the normalized candle source and complete signal evidence;
- requires an independent risk decision;
- fixes provider mutation, execution, real funds, mainnet, and withdrawals to
  `false`.

An execution-locked assessment bridge binds the signal hash to the exact
product, side, closed-candle reference price, timestamp, local fee/slippage
preview, deterministic risk decision, and reservation draft. A verified
assessment can then produce a synthetic fill and run the existing exact FIFO
accounting engine. BUY and SELL rehearsals therefore exercise acquisition lots,
fee handling, lot consumption, realized P&L, and position projection without
claiming that an exchange order or exchange fill exists.

Migration 030 and its source-only evidence store provide an explicit,
transactional D1 projection of the signal, locked assessment, and simulated
accounting result. The projection is immutable and idempotent. It remains
unwired: evaluation does not automatically persist, and no Worker route invokes
the store.

The source-only simulation runner composes the complete flow using one trusted
injected clock and an independently supplied risk/sizing input builder. A HOLD
signal terminates with `NO_ACTION`; it cannot create an assessment, fill,
accounting result, or projection. BUY and SELL signals can be projected only
when the caller supplies an explicit projection request and D1 environment.
The runner has no default fetcher, route, trigger, retry loop, provider client,
or automatic persistence.

An account-scoped SELECT-only read model exposes sanitized certification
activity for a future authenticated operator route. It includes the signal,
exact reference/fill amounts, quote commission, position quantity and cost
basis, and realized P&L. It omits exchange-account IDs, internal order/fill IDs,
evidence hashes, raw evidence JSON, and ledger account identifiers, and rejects
any stored row with a corrupted capability lock.

An account-and-product-scoped state loader reloads only the latest immutable
simulation, verifies both the simulation and nested accounting hashes, rejects
corrupted capability locks or non-canonical FIFO lots, and supplies the exact
remaining lots and cumulative realized P&L to the next rehearsal. A missing
history produces an explicit empty state; an existing history can no longer be
silently replaced with an empty portfolio.

The candle-direction volume proxy is not presented as exchange order-flow
delta. A true order-flow delta requires a separately reviewed public-trade or
book-event contract.

## Current isolation

The certification modules are not imported by any deployed Worker entrypoint.
They have no public route. Production migration, route exposure, and first-time
production persistence require separate operator approval, authentication
review, migration evidence, and release validation.
