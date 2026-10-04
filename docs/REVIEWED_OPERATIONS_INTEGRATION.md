# Reviewed operations integration

The private `index_reviewed_operations.ts` service connects existing immutable
operator reviews to the existing account coordinator. It does not create a second
state owner, manufacture a review, submit an exchange order or activate mainnet.
`wrangler.reviewed-operations.toml` disables workers.dev and preview URLs, has no
public routes/triggers, and imports the candidate's Durable Object namespace by
`script_name`. Its D1 binding must be the same isolated candidate database.

The service accepts three explicit POST commands:

| Path | Exact JSON fields | Immutable review resource |
| --- | --- | --- |
| `/reviewed/recovery-accounting/dispatch` | `dispatchId`, `planId`, `approvalEventId` | Existing approved recovery accounting plan |
| `/reviewed/reservations/settle` | `fillId`, `authorizationEventId` | `ORDER_RESERVATION_SETTLEMENT` for the persisted order |
| `/reviewed/orders/complete` | `orderId`, `authorizationEventId` | `ORDER_COMPLETION` for the persisted order |

Operator identity uses the existing actor-bound hashed API-key mapping. The
service checks credentials before reading D1, requires the review's actor to
match the authenticated actor, derives account routing from persisted evidence,
and requires a current scoped risk role. Only validated immutable IDs and the
internal accounting credential reach the coordinator. There is no automatic
retry if the coordinator becomes unavailable. Current operation-specific roles
and operations step-up sessions are reloaded again inside the coordinator's
shared account queue. A revocation while queued therefore prevents mutation.

Reviewed fill settlement derives the accounting hash, original reservation,
active ledger pair and posted reservation backing from D1. It accepts no amount,
ledger identifier, clock or terminal-state override. Ambiguous multiple reserves
require a separate allocation review instead of choosing the first reservation.
Every new settlement is nonterminal: it consumes the actual posted fill journal
without releasing the remainder. The immutable review time provides stable
receipt input; replay preserves the persisted settlement time. Completion needs
its own review, verifies provider terminal observations and totals, then releases
the exact remainder through migration 034. Existing terminal settlement receipts
are not reinterpreted as a new nonterminal settlement.

The integration also includes bounded recovery discovery/GET consumers,
account-scoped attestation, actual reviewed FIFO dispatch, authenticated order
event delivery, atomic request admission, frontend unknown-state handling, and
canonical Cloudflare account validation before the paper migration/deploy command.

## Verification and deployment boundary

Real SQLite tests exercise private ingress through the actual coordinator,
recovered BUY/SELL FIFO accounting, per-fill consumption, partial cancellation
release, final completion, replay, outages and role/session revocation. Network
provider fixtures remain local test evidence, never external certification.

The current candidate and private-service resource IDs are placeholders.
Production was inspected on 2026-10-04: the canonical account contains only the
production crypto-signal Worker, its production D1 database and production KV
namespace in the available lists. The production Worker settings confirm its R2
binding; direct R2 listing returns 403 with the available OAuth permissions.
No isolated coordinator deployment or candidate-resource configuration has been
verified. The integrated source has not been merged or deployed.

Apply live migrations 003–030, 033 and 034 only to a reviewed isolated candidate
D1 database. Production management migrations 031–032 and paper admission
migration `paper/003` have their own paths. Do not bind this service to production
paper D1. Configure the two service secrets securely; never put raw operator keys
or accounting tokens in configuration files. Preserve append-only evidence when
rolling back code.

Live submission/cancellation still require a separately reviewed executable
artifact, current account-specific external provider certification, release and
runtime control binding, durable attempts and recovery evidence. BTCC's current
authoritative contract is unverified. Do not label these capabilities Active or
all-pass based on these source tests.
