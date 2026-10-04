# Reviewed internal order completion runtime

This phase adds `POST /candidate/orders/complete` to the existing observed
exchange account coordinator. The public candidate Worker still rejects mutation
methods. No provider request, production deployment, mainnet activation, transfer
or withdrawal is introduced.

The trusted internal caller must route with `idFromName(exchangeAccountId)`, use
`X-Candidate-Accounting-Token`, and submit exactly:

```json
{"orderId":"persisted-order-id","authorizationEventId":"completion-review-id"}
```

No amount, account, time, fill or terminal-state override is accepted. The JSON
reader cancels an oversized body stream before buffering beyond 512 KiB.

An existing immutable `live_authorization_events` decision must explicitly allow
`RUN_RECONCILIATION` for resource type `ORDER_COMPLETION` and the same order. The
review must be less than five minutes old and use a current operations step-up
session. The runtime reloads current scoped RISK_OPERATOR/RISK_ADMIN authority
inside the shared account accounting queue, after any earlier operation finishes.
Accounting-plan review and trading/cancellation authorization do not substitute
for completion review. A trusted operator ingress must persist the authorization
through the existing authorization service; this endpoint cannot create its own
review, role or session.

For filled orders, the command finalizes only after existing fill accounting and
reservation settlement receipts are present and their journals remain posted.
It does not automatically settle a fill or authorize accounting.

For zero-fill CANCELLED, REJECTED or EXPIRED orders, it verifies the latest stored
REST, WebSocket or reconciliation terminal event, zero provider totals, absence
of fills, and a posted reservation journal backing the exact amount. It derives
available/reserved ledger accounts from the persisted account, asset and active
type pair. A single D1 batch releases all pending reservations and inserts
append-only release receipts. Database guards reject changed reservation versions,
provider quantities, terminal observations, or ledger restrictions and roll back
release journals and reservation updates together. No synthetic fill is created.

Migration `033_live_zero_fill_reservation_release.sql` must be applied to the
isolated candidate D1 database before enabling this internal command. Migration
032 already belongs to production paper-order idempotency; it is not replaced.
The live migration verifier includes 003–030 and 033; production migrations
031–032 remain in their own verification path.

Release and final order completion are separate atomic projection batches. If
completion fails after release, the order remains terminal and unsettled. A
subsequent explicit command rechecks current authority, validates the immutable
release receipt and posted journal, then resumes completion without another
release. There is no scheduled retry. Late fills or changed/reversed journals
block recovery rather than producing a success label. Partial-fill cancellation
still requires existing per-fill settlement and a separately reviewed remainder
release when its last fill was previously settled as nonterminal; this phase does
not reinterpret an earlier immutable settlement receipt.

Validation uses actual SQLite with foreign keys, actual reservation/fill journal
builders, the real authorization recorder, and the actual internal coordinator
handler. Tests cover cancellation release, filled completion, replay, concurrent
commands, role/session revocation while queued, approval expiry/scope/audience,
stream limits, missing backing journals, late quantity/ledger changes, receipt
rollback and failure between release and completion. Fixture evidence does not
certify a live exchange or mark a provider ACTIVE.

Rollback reverts the runtime route. Preserve migration 033 and its append-only
receipts once applied; do not delete financial evidence.
