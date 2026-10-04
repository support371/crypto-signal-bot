# Reviewed recovery accounting runtime

The candidate account coordinator now handles internal POST
`/candidate/recovery-accounting/dispatch`. This closes the missing runtime call
from an explicit, persisted, independently reviewed recovery plan to the existing
fresh dispatch orchestrator and verified FIFO accounting service. It does not
enable provider submission, cancellation, reservation settlement or withdrawals.

The caller must use the existing namespace's `idFromName(exchangeAccountId)`;
unnamed objects fail closed. The existing internal accounting token is required.
The body contains only `dispatchId`, `planId` and `approvalEventId`. Scope,
commands, reviewer identity and time come from the named coordinator, immutable
plan/approval records, current authority records and the trusted runtime clock.
Client-supplied commands, timestamps, role claims and account overrides are rejected.

The existing shared accounting queue serializes this stage with ordinary FIFO
posting and reconciliation. After queue admission, the orchestrator verifies
the approval's hash, validity and account scope, then reloads reviewer roles and
the exact step-up session through the existing authorization policy. Revoked,
expired or out-of-scope authority stops before the attempt claim. The review must
belong to a different actor from the plan preparer. An immutable attempt is
claimed before posting any fill. Each fill, journal, FIFO lot/position and receipt
remains in the existing atomic D1 projection batch.

Failure after some fills produces persisted partial dispatch evidence. Failure
before aggregate dispatch persistence leaves the immutable attempt as evidence
of interruption. Neither condition authorizes automatic retry. A new independent
approval is required; existing fill receipts replay without another journal or
fill. Completion does not settle a reservation or mark an order settled.

## Verification boundary

The real SQLite tests apply the existing migrations with foreign keys enabled,
exercise the actual internal fetch handler, and verify buy/sell fees, FIFO P&L,
scope and authentication denial, expiry/self-approval/revocation, shared-queue
contention, partial dispatch and restart after projection persistence failure.
They do not emulate Cloudflare's constructor/SQL runtime or prove a deployed
Durable Object namespace. All fixtures are local and credential-free.

This is one integration in the unfinished mainnet target. The public candidate
Worker continues rejecting mutations. Trusted operator ingress, account-to-ledger
configuration, reservation/order-state completion, deployed coordinator bindings,
external provider certification and live release acceptance remain required.
BTCC still needs an authoritative current provider contract. No provider is
armed or active on the strength of these tests.

Rollback: revert this integration. No new migration or resource is required,
and existing immutable attempt and accounting evidence must be preserved.
