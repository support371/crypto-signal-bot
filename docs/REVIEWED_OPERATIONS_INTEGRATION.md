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


## Resource metadata preflight

`npm --prefix worker run verify:candidate-resources` validates the canonical
build account and configuration isolation, then makes bounded authenticated GET
requests for the candidate D1 database, KV namespace list (first 100 entries),
and R2 bucket metadata. A missing/denied/mismatched response is a blocking result,
never proof that a resource does not exist. Use `verify:reviewed-resources` to
verify the projection-only deployed coordinator namespace and D1 binding before
private-service deployment. This private profile does not require KV/R2 or
provider secrets; the full candidate-resource check retains those prerequisites. `deploy:reviewed-operations` runs that check directly
before Wrangler, including when npm lifecycle hooks are disabled. The templates
for the full provider artifact still fail before network because its IDs are
placeholders. Projection profiles reference the separately verified isolated D1.

The preflight requires the deployment process's `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`; neither a runtime account variable nor an API token from
another account selects the canonical deployment. Token permissions must allow
resource metadata inspection. Raw API responses, upstream error messages and
credentials are never printed. The result reports resource verification only;
it does not certify a provider or verify mainnet activation. This check creates,
deletes and changes no resources, bindings or provider state.


## Coordinator-only deployment profile

`wrangler.reviewed-coordinator.toml` bundles the same candidate Worker name,
`ExchangeAccountCoordinator` class and `v1` SQLite namespace migration as the
full candidate artifact. It exports only the existing coordinator and a 404
public handler. workers.dev/preview URLs are disabled, with no public routes,
triggers or provider credentials. Its only resource prerequisite is isolated D1.
Later expansion of this same Worker/class keeps the namespace rather than
creating a second account authority. The private operations service imports that
same namespace.

`prepare:reviewed-migrations` copies only the 31 live files (003–030, 033–034)
into a generated migration directory. Sequential unique filenames preserve source
order while avoiding duplicate 018 prefixes. Wrangler tracks these in
`d1_migrations`. Actual Wrangler local application passed for all 31; a second
application reported no migrations to apply. A Miniflare/workerd test exercises
the real SQLite coordinator constructor, named account scope, credential checks
and private public-handler rejection; financial tests separately use real SQLite
with accounting/reservation/authorization evidence.

On 2026-10-04, GEM-ASSIST reconnected after HTTP 504. Read-only discovery resolved
the previous uncertain request before isolated D1 creation. Canonical database
`crypto-signal-bot-live-candidate-db` is `45d89a06-e8de-432b-a3f0-bd4a5c47e922`;
the real projection-only metadata preflight passed. The full provider artifact
remains a locked template; only coordinator/operations profiles reference this D1.

The remote migration stopped at 016 after 13 successful files. Read-only schema
inspection confirmed the failed file had not partially added its version column
or settlement tables. The generated copies rewrite conditional trigger aborts to
equivalent `SELECT RAISE(...) WHERE NOT EXISTS (...)` SQL, avoiding the remote
parser's rejection of an inner `CASE ... END;`. Original source migrations,
tracking names and abort conditions remain intact. Local equivalence tests cover
matching, missing and null backing evidence. Remote retry succeeded for all 31 files; a repeat apply had no pending migrations.
Both private Workers deployed from reviewed source f3aa456e5b66d15cf214a95d80b372826996fc2d.
Actual API metadata confirms shared namespace `f847b9626f464c69a322b2c99b474ab1`,
the same isolated D1 and internal secret bindings. Both workers.dev and preview
URLs are disabled. Operator credential hashes and provider credentials remain
unconfigured; deployment does not grant trading authority or certification.

`npm --prefix worker run verify:reviewed-bindings` performs bounded GET inspection
of both deployed Workers, D1 and subdomain settings. It rejects a second namespace,
wrong namespace owner, mismatched database, missing internal credential binding or
enabled/missing public-URL settings. It reports operator credential binding
configuration separately and never reports provider certification or mainnet
activation as verified. Metadata verifies credential binding presence, not secret
values or a successful financial command.
