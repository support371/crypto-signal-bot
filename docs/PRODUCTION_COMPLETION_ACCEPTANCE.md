# Production completion acceptance — integrated source

Verified on 2026-10-04. Source validation and deployment/provider activation are
separate evidence. A dry-run does not establish deployed bindings or external
provider certification.

| Capability | Current evidence | Status |
| --- | --- | --- |
| Canonical deployment account guard | CLI/npm rejection tests; canonical Worker/KV/D1 API inspection | Source verified |
| Bounded recovery discovery and read consumer | GET-only transport, account/attestation binding, bounded attempts and outage tests | Source verified |
| Reviewed recovered-fill FIFO dispatch | Real SQLite ingress/coordinator tests; immutable attempts/receipts; independent approval | Source verified |
| Reviewed per-fill reservation consumption | Real posted reserve and fill journals; derived ledger pair; explicit operation review | Source verified |
| Zero-fill cancellation release | Migration 033; real SQLite rollback, scope and replay tests | Source verified |
| Partial-fill cancellation remainder | Migration 034; exact remaining amount; original receipt preserved; crash/replay tests | Source verified |
| Evidence-complete order finalization | Terminal provider evidence, fill totals, accounting/settlement proof, CAS/event atomicity | Source verified |
| Private operator routing | Actor-bound credentials; persisted scope; shared candidate namespace; queue-time revocation | Source verified |
| Private realtime order delivery | Supabase/D1 account authorization, event cursor and reconnect tests | Source verified |
| Current production paper deployment | Previously deployed canonical Worker; current KV/D1/R2 binding metadata rechecked | Paper deployment verified; new integration not deployed |
| Isolated candidate/private service bindings | Canonical isolated D1 created and metadata verified; projection profiles reference its UUID; namespace/service not deployed | D1 configured; deployment pending |
| Bitget external provider certification | Current Classic/UTA docs inspected; no authenticated account-specific run | Unverified |
| BTCC authoritative contract and certification | Current official REST mutation contract not established | Blocked on provider evidence |
| Mainnet submission/cancellation | No reviewed executable artifact wired to an activated release | Incomplete |
| Real-money activation / withdrawals | Independent gates remain closed | Inactive |

Combined validation before remote packaging follow-up: 563 Worker foundation tests, 188 provider contract tests, 54 HTTP contract tests, 51 frontend tests,
worker/architecture typechecks, frontend lint, production/target/usage contracts,
operator frontend safety, paper/regulated/certification/candidate safety gates,
and isolated migration empty/upgrade/replay checks passed. Private operations, coordinator-only and
full candidate Wrangler bundles passed dry-run. Actual local workerd/SQLite
coordinator construction and named-scope checks passed. All 31 live migrations
applied through Wrangler locally; a second apply had no pending migrations. Provider tests use local fixtures.
The frontend build and performance budget also passed (256605-byte entry,
17 dynamic entries). These results do not certify provider/network availability.
The resource metadata preflight is implemented and tested; the full provider
artifact remains a placeholder template and blocks before any network request. It requires actual isolated resources and
sufficient inspection permissions before deployment.

The next activation dependencies are real isolated resource IDs/permissions,
secure operator and provider credential provisioning, account-specific provider
contracts and external evidence, current release approval, and the separately
reviewed executable submission/cancellation artifact. Preserve BTCC→Bitget
provider selection; do not retry or fail over an ambiguous mutation. Public
paper behavior and independently gated withdrawals remain protected.


Deployment resume checkpoint: GEM-ASSIST reconnected. Read-only discovery
resolved the earlier unknown mutation outcome; the isolated database was then
created as `45d89a06-e8de-432b-a3f0-bd4a5c47e922` on the canonical account.
The actual projection-only preflight passed. Remote migration applied the first
13 files, then rejected migration 016 with `incomplete input`. A read-only schema
check confirmed migration 016 had not partially added its column/tables.
Generated migration packaging now expresses conditional trigger aborts as
`SELECT RAISE(...) WHERE NOT EXISTS (...)` instead of `SELECT CASE ... END;`,
preserving the guards and original source migrations. Equivalent abort behavior,
all guard counts, empty application and tracked replay pass locally. Remote
retry, namespace deployment and service/provider activation remain pending.
The projection-only profile needs D1 and keeps the same candidate namespace;
R2 permissions are unnecessary for this scoped projection artifact.

Provider response follow-up: candidate acknowledgement now requires both a valid
2xx HTTP status and the exact Classic API success code `00000`; echoed order IDs
cannot override a missing/error code. A demo cancel acknowledgement now retains
its matching GET recovery instruction. Runner tests prove one cancel POST and
one read-only recovery call, preserving incomplete observations without another
mutation or automatic accounting. This does not activate a live cancel route.
