# Live Execution Rollout

This branch introduces the first fail-closed boundary around the existing
exchange adapters. It does **not** turn on real-money trading.

## Runtime behavior

Paper mode is unchanged. When `TRADING_MODE=live`, a new order is blocked unless
all readiness checks pass:

- a non-paper exchange adapter is active;
- `LIVE_EXECUTION_ENABLED=true`;
- `LIVE_OWNER_APPROVED=true`;
- `LIVE_APPROVAL_ID` is present;
- `BACKEND_API_KEY` is configured;
- the guardian is not halted;
- `LIVE_ALLOWED_SYMBOLS` contains the requested symbol;
- `LIVE_MAX_ORDER_NOTIONAL_USDT` is positive and the order is below the cap;
- testnet requires `LIVE_TESTNET_ENABLED=true`;
- mainnet additionally requires both `ALLOW_MAINNET=true` and
  `LIVE_MAINNET_ENABLED=true`.

The readiness API returns only booleans and configuration presence. It never
returns API keys, approval identifiers, or exchange secrets.

## Recommended staged rollout

1. Keep production in paper mode.
2. Repair market-feed freshness and portfolio-state integrity.
3. Run the adapter guard on exchange testnet with a very small notional cap.
4. Add durable idempotency and exchange-order reconciliation.
5. Complete automated readiness metrics and a seven-day paper validation.
6. Review the pull request and run CI.
7. Only after the documented readiness criteria pass, request explicit owner
   approval for a separate mainnet configuration change.

## Remaining work

- persistent idempotency keys at the intent boundary;
- durable order/fill/reconciliation storage;
- partial-fill and restart recovery;
- independent live and paper ledgers;
- exchange precision/minimum-order validation;
- alerting for stale feeds and reconciliation drift;
- production deployment wiring for the canonical backend;
- controlled canary limits and emergency close procedures.
