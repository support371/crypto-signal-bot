# Provider credential provisioning

On 2026-10-04, the canonical account's credential store was created and verified:

- Account: `d944e40760494a6843e521cd57c15dfd`
- Store: `crypto-signal-bot-provider-credentials`
- Store ID: `b5f2c2cdae2c445b8ead1ceda7620fed`
- Dashboard: https://dash.cloudflare.com/d944e40760494a6843e521cd57c15dfd/secrets-store

The dashboard route follows Cloudflare's official Secrets Store documentation
deep link `/?to=/:account/secrets-store`. Select this store and **Create secret**,
choose the **Workers** permission scope, then enter each value directly into
Cloudflare. Saved values cannot be viewed again through the dashboard. Never
enter them into Git, build variables, browser frontend variables or chat.

## Required for read-only account certification

| Secret name | Provider value |
| --- | --- |
| `BITGET_CERT_API_KEY` | Dedicated read-only Bitget API key |
| `BITGET_CERT_API_SECRET` | Its API secret |
| `BITGET_CERT_API_PASSPHRASE` | Its API passphrase |

This key must have no trading, transfer or withdrawal permission. The existing
certification client verifies actual account identity and permission responses;
key names or a store entry do not establish that verification.

## Separate credential group for the reviewed trading artifact

| Secret name | Provider value |
| --- | --- |
| `BITGET_TRADE_API_KEY` | Separate Bitget trading API key |
| `BITGET_TRADE_API_SECRET` | Its API secret |
| `BITGET_TRADE_API_PASSPHRASE` | Its API passphrase |

Trading keys must not have withdrawal/transfer authority. These bindings remain
in the undeployed trade quarantine config; entering values does not enable trading.
Do not use a mainnet key as a demo credential or as the read-only certification key.
Demo credentials and their account-specific lease mapping will be provisioned
separately once provider account model and demo availability are verified.

No BTCC key names are requested yet: its current authoritative API contract is
unverified, so the application cannot responsibly choose its authentication model.

The store was verified empty after creation. The candidate and quarantine source
configs now reference its actual ID. Run `npm --prefix worker run
verify:provider-secret-store` with a server-side Cloudflare token to confirm the
three certification secret names and Workers scope once entered. That check reads
only metadata and cannot certify permissions, account model or real-money readiness.

The mainnet executable runtime is still under development. Its durable admission
primitive now atomically claims attempt/order/idempotency identity and daily
used-plus-reserved exposure in the existing account coordinator's SQL storage.
It is source-only, has no Worker route and grants no execution capability. Current
authority loading, provider certification, transport composition and activation
remain required before an actual submission/cancellation can run.
