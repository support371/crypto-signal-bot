# Persistence Release Checklist

## Purpose

Use this checklist before moving production state from JSON files to a relational database.

## Pre-migration checks

- [ ] Current JSON files are backed up.
- [ ] Audit and earnings export format is documented.
- [ ] New schema has been reviewed against current API responses.
- [ ] Migration tooling is available in the deployment image.
- [ ] Local development path works with SQLite or an equivalent lightweight store.
- [ ] Production path works with PostgreSQL.

## Repository layer checks

- [ ] Audit writes pass through a repository interface.
- [ ] Earnings writes pass through a repository interface.
- [ ] Reads remain backward compatible with current JSON response shapes.
- [ ] Storage errors are surfaced in health checks.
- [ ] The old JSON store remains available as fallback until parity tests pass.

## Cutover checks

- [ ] Dual-write is enabled for at least one release window.
- [ ] JSON and DB audit counts match.
- [ ] JSON and DB earnings summaries match.
- [ ] Restart test proves state survives container restart.
- [ ] Backup restore test has been executed.

## Production gate

Do not cut over until:

- [ ] backend tests pass
- [ ] release verification passes
- [ ] persistence health is visible on `/health`
- [ ] rollback path is documented
- [ ] operator has confirmed current JSON backup exists

## Rollback

If the DB cutover fails:

1. Switch storage mode back to JSON fallback.
2. Restore the last known-good JSON files.
3. Restart backend.
4. Verify `/health`, `/audit`, `/earnings/summary`, and `/earnings/history`.
5. Preserve failed DB state for forensic analysis.
