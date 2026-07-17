# Live Execution Architecture

## Current status

This branch adds a production-safe foundation for future real-money execution. It does not enable live orders, deposits, or withdrawals.

The live candidate Worker is a separate read-only entrypoint:

- `worker/src/index_live_candidate.ts`
- `wrangler.live-candidate.toml`

It blocks all non-safe HTTP methods, all legacy financial routes, `/v1/orders*`, and `/v1/withdrawals*` with HTTP 403.

## Activation model

A future live runtime must require all of the following at the same time:

- an explicitly live-capable build;
- mainnet and live execution flags;
- a configured release ID;
- an active, unexpired `release_authorizations` row;
- exact deployed Git SHA equality;
- recorded worker and frontend deployment IDs;
- product allowlist;
- security review reference;
- compliance review reference;
- Guardian clear state;
- successful recent reconciliation;
- eligible exchange account.

The candidate build intentionally reports `liveReady: false` even when its activation prerequisites are present. A separate reviewed implementation must supply the actual execution adapter and account coordinator.

## Financial representation

Financial values in the new domain are decimal strings. They must not be converted to JavaScript floating-point numbers for accounting, risk, reservation, order sizing, fees, or P&L.

`worker/src/live/domain.ts` contains the initial exchange-independent contracts and strict decimal-string boundary validation.

## Durable authorization

Migration `worker/migrations/003_live_release_authorizations.sql` creates the release-authorization record. It seeds no active authorization.

A release authorization is bound to:

- release ID;
- Git SHA;
- Worker deployment ID;
- frontend deployment ID;
- schema version;
- exchange and hashed account reference;
- allowed products;
- order and daily notional limits;
- start and expiration times;
- security and compliance review references.

## Secrets

No exchange credentials are accepted by this branch. Future credentials must exist only in Cloudflare encrypted secrets or an equivalent server-side secret manager. They must never appear in source code, TOML variables, D1, KV, frontend environment variables, browser storage, logs, or test fixtures.

## Next implementation slices

1. Validated order state machine and append-only events.
2. Durable idempotency and account-level serialization.
3. Exact-decimal arithmetic implementation.
4. Native Coinbase product, account, preview, order, fill, and user-stream adapters.
5. Reservations and double-entry ledger.
6. REST and user-stream reconciliation.
7. Guardian hierarchy and account halts.
8. Isolated transfer service with withdrawals disabled by default.
9. Frontend order-preview and operational control surfaces.
10. Certification, rollback, monitoring, and incident evidence.
