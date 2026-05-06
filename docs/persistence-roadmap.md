# Persistence Migration Roadmap

## Objective

Move production state away from JSON files and into a durable relational store without breaking the current paper-trading runtime.

## Current state

The app still uses file-backed stores for audit and earnings data:

- `AUDIT_STORE_PATH=backend/data/audit.json`
- `EARNINGS_STORE_PATH=backend/data/earnings.json`

This is acceptable for local paper mode but not production.

## Target state

1. Keep JSON stores as development fallback.
2. Add a relational schema for audit events, orders, fills, positions, balances, earnings, guardian events, and reconciliation reports.
3. Introduce repository interfaces so API routes depend on storage contracts, not files.
4. Add migrations before switching production reads and writes.
5. Gate the production storage backend through environment configuration.

## Migration phases

### Phase 1 — schema foundation

- Add migration tooling.
- Define initial tables.
- Add local SQLite-compatible development path.
- Add production Postgres-compatible path.

### Phase 2 — repository layer

- Create repository interfaces for audit and earnings first.
- Add dual-write option for audit events.
- Keep reads on JSON until parity tests pass.

### Phase 3 — cutover

- Switch reads to the relational repository.
- Keep JSON export as backup/diagnostic only.
- Add release verification checks for migration status.

### Phase 4 — production hardening

- Add backup and restore runbook.
- Add reconciliation reports and retention policy.
- Add connection health to `/health`.

## Release gate

Do not remove JSON fallback until all are true:

- audit repository tests pass
- earnings repository tests pass
- migration upgrade/downgrade tested locally
- backup export tested
- release verification includes storage health
