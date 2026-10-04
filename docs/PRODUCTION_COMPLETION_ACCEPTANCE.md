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
| Isolated candidate/private service bindings | Configurations still contain placeholder IDs; candidate absent from available account resource lists | Not configured/deployed |
| Bitget external provider certification | Current Classic/UTA docs inspected; no authenticated account-specific run | Unverified |
| BTCC authoritative contract and certification | Current official REST mutation contract not established | Blocked on provider evidence |
| Mainnet submission/cancellation | No reviewed executable artifact wired to an activated release | Incomplete |
| Real-money activation / withdrawals | Independent gates remain closed | Inactive |

Combined validation: 550 Worker foundation tests, 184 provider contract tests,
worker/architecture typechecks, frontend lint, production/target/usage contracts,
operator frontend safety, paper/regulated/certification/candidate safety gates,
and isolated migration empty/upgrade/replay checks passed. Private operations and
candidate Wrangler bundles passed dry-run. Provider tests use local fixtures.
The frontend test/build results are recorded in the release evidence alongside
this artifact; they do not certify provider/network availability.

The next activation dependencies are real isolated resource IDs/permissions,
secure operator and provider credential provisioning, account-specific provider
contracts and external evidence, current release approval, and the separately
reviewed executable submission/cancellation artifact. Preserve BTCC→Bitget
provider selection; do not retry or fail over an ambiguous mutation. Public
paper behavior and independently gated withdrawals remain protected.
