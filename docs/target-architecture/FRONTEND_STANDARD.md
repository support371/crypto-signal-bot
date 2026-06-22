# Frontend Operating Standard

The frontend must make the target architecture visible without pretending incomplete backend modules are already production-ready.

## Required information hierarchy

1. **Runtime safety banner**
   - paper mode;
   - testnet mode;
   - mainnet disabled;
   - external withdrawals blocked.

2. **System flow view**
   - market data gateway;
   - scouts;
   - signal fusion;
   - risk engine;
   - execution engine;
   - position guardian;
   - portfolio ledger;
   - protected reserve;
   - monitoring and audit.

3. **Capital state**
   - available trading cash;
   - reserved cash;
   - protected reserve;
   - invested cost basis;
   - open market value;
   - realized PnL;
   - unrealized PnL;
   - total equity.

4. **Decision transparency**
   - latest scout observations;
   - fusion score;
   - risk decision;
   - reason codes;
   - market-data age and source;
   - active exit plan;
   - strategy/model version.

5. **Position protection**
   - highest price since entry;
   - current protected floor;
   - partial-take-profit status;
   - remaining quantity;
   - cooldown state;
   - guardian action.

6. **Operational health**
   - Worker health;
   - market-feed freshness;
   - guardian state;
   - D1/KV availability;
   - latest CI result;
   - active frontend deployment;
   - incident status.

## Page structure

Recommended primary navigation:

- Dashboard
- Signals
- Portfolio
- Trading
- Paper Trading
- System Architecture
- Analytics
- Backtesting
- Alerts
- History
- Exchange Connections
- Settings/Admin

The `/system-architecture` page is the visible target showcase for agents, engineers, reviewers, and stakeholders.

## Visual rules

- Use clear state labels: `TARGET`, `IMPLEMENTED`, `PARTIAL`, `BLOCKED`, `PAPER ONLY`.
- Never display a simulated value as if it were verified live data.
- Every time-sensitive value must show `updated_at` or age.
- Every decision card should show reason codes.
- Risk and safety status must remain visible on mobile.
- Avoid generic green/red decoration without labels and context.
- Keep frontend API calls read-only unless the user is performing an explicit paper-mode action.

## Data contracts

The frontend should consume typed DTOs rather than infer fields from loose JSON.

Minimum target DTOs:

- `RuntimeSafetyDto`
- `MarketIntegrityDto`
- `ScoutObservationDto`
- `SignalFusionDto`
- `RiskDecisionDto`
- `PaperOrderDto`
- `PositionGuardianDto`
- `PortfolioLedgerDto`
- `ProtectedReserveDto`
- `OperationalHealthDto`
- `AuditDecisionDto`

## Error behavior

- Partial subsystem failures must render independently.
- Never replace unavailable data with fake success values.
- Stale data should display an age warning.
- A blocked risk decision should display why it was blocked.
- Mutation failures should never optimistically alter financial totals.

## Frontend implementation sequence

1. Add the System Architecture page and route.
2. Add runtime and safety badges to the shared layout.
3. Add typed target DTOs.
4. Add read-only architecture status endpoint integration.
5. Add capital-state cards.
6. Add decision-audit timeline.
7. Add position guardian view.
8. Add protected-reserve view.
9. Add latency and market-data quality panels.
10. Add integration and test coverage for partial failures.
