# Full live implementation and acceptance

Local test passes and created Cloudflare resources do not establish a working
mainnet trading system. Completion requires the following connected evidence.

| Stage | Present state | Evidence required to complete |
| --- | --- | --- |
| Isolated accounting infrastructure | Private gateway, shared coordinator namespace and migrated D1 deployed | Preserve matching canonical account/resources; verify exact deployed revisions |
| Credential provisioning | Store exists; last successful metadata inspection reported zero secrets | Owner enters six exact names from `PROVIDER_CREDENTIAL_PROVISIONING.md`; metadata check verifies names and Workers scope |
| Actual provider contract | Bitget public Classic/UTA contracts inspected; private read-only certification service prepared; actual account model unknown; BTCC authoritative contract unavailable | Authenticated Bitget identity/permission checks and verified account model; official current BTCC contract before its adapter |
| Current trading authority | Source check reloads authorization event, current roles, step-up, account and order in one transactional snapshot | Integrate inside the account coordinator alongside current Guardian, risk, actual reservation and provider certification loaders |
| Dispatch admission | Source SQL journal atomically claims attempt/order/idempotency and exact daily exposure | Connect authoritative release scope and all current controls; preserve claims after uncertain sends |
| Submission and cancellation | Mainnet executable transport/composition is incomplete | Account-model-specific signing, UID rate limits, one-shot POST, current control recheck before credentials, bounded response handling and GET-only ambiguity recovery |
| Order completion | Reviewed accounting/settlement/remainder-release implementation exists | Connect real provider order/fill observations through the shared coordinator; prove partial fills, cancel/fill races, FIFO, fees and reservation completion |
| External rehearsal | Local fixtures passed; credential-backed rehearsal not run | Provider-supported demo environment and distinct demo credentials; prove submit, lookup, cancel and accounting without real funds |
| Release deployment | Draft code is unmerged; no new executable Worker deployed | Reviewed exact source/deployment/schema/account/product evidence, configured limits, deployment/binding verification, health/observability and rollback checks |
| Mainnet activation | Disabled | All prior acceptance evidence current; exact authorized release active with explicit account/product/limit scope |

The current-authority loader cannot authorize credentials or a send by itself.
It rejects revoked/expired current roles or sessions even when the stored event
still says ALLOW. PLACE requires an eligible, reconciled READY account and an
unsent reserved order. CANCEL can retain current authorized risk/trader access
under a halted account but rejects terminal, recovery-required or already-pending
orders. Risk/reservation/provider certification remain independent checks.

Owner input now consists of provider-issued secret values entered directly in
the named Cloudflare store. Values must never be provided in chat or Git. The
engineer performs implementation, binding checks, deployment preparation and
external verification. Demo credentials must not be replaced with mainnet keys.
BTCC may remain unavailable while Bitget is implemented, but that cannot be
reported as a completed BTCC integration or ALL PASS for both providers.

Final acceptance must report measured results for each stage. Active means the
reviewed runtime is actually deployed and operating within its release scope,
not merely that a configuration flag or dashboard label says Active. Withdrawals
remain outside this trading release and disabled.
