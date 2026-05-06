# Branch Salvage Workflow

## Purpose

This workflow inventories remote branches for abandoned or leftover implementation assets without mutating runtime code. It is designed to preserve flexibility while preventing stale/demo/secret-bearing files from being promoted blindly.

## Command

```bash
make branch-salvage
```

Direct invocation:

```bash
python scripts/branch_salvage_inventory.py --remote origin
```

## Outputs

Generated under `manifests/branch_salvage/`:

- `branch_file_inventory.csv` — all scanned branch files with commit, path, hash, size, extension, and classification.
- `duplicate_paths.csv` — paths repeated across branches.
- `duplicate_blobs.csv` — identical file contents appearing in multiple branch locations.
- `promotable_candidates.csv` — likely salvage candidates.
- `summary.json` — high-level scan totals.

## Classifications

- `PORT_CANDIDATE` — likely useful code or operational logic worth reviewing for promotion.
- `REFERENCE_OR_PORT` — tests, config, CI, and supporting files that may be ported or used as implementation references.
- `REFERENCE_ONLY` — docs and low-risk reference material.
- `DO_NOT_PROMOTE` — archives, logs, DB files, generated artifacts, secrets-like paths, and other non-runtime assets.

## Promotion Rules

1. Never copy branch content directly into production runtime paths without review.
2. Preserve provenance: branch, commit SHA, original path, and blob hash.
3. Treat exchange adapters, guardian logic, reconciliation logic, risk logic, signal logic, and tests as highest-value salvage candidates.
4. Treat logs, archives, database files, env files, and credentials-like files as do-not-promote.
5. Any promoted code must pass:
   - `make repo-audit`
   - backend test suite
   - frontend build when frontend paths are touched
   - relevant live/testnet smoke tests when exchange behavior changes

## Review Checklist

For each `PORT_CANDIDATE`:

- What branch and commit produced it?
- Is it newer or more complete than the current mainline implementation?
- Does it contain synthetic/demo behavior?
- Does it create new secret, auth, or live-trading risk?
- Can it be covered by a focused test before promotion?

## Next Production-Hardening Focus

After branch salvage inventory exists, prioritize:

1. DB-backed audit persistence.
2. Guardian halt/resume flow hardening.
3. Reconciliation drift detection.
4. Supabase/JWT write-endpoint hardening.
5. Binance, Bitget, and BTCC testnet certification.
