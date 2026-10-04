# Canonical Worker deployment account

The canonical `crypto-signal-bot-api.analyzer-d94.workers.dev` Worker belongs to account `d944e40760494a6843e521cd57c15dfd`. This account and its resources were verified through authenticated Cloudflare APIs on 2026-10-04:

| Binding | Verified resource |
| --- | --- |
| `AGENT_MEMORY` | KV namespace `2dcb1050b9c846a7bba8cd1c3c43df62` |
| `DB` | D1 database `crypto-signal-bot-db`, UUID `6046c4fd-87de-4b56-be9d-917d6994a86b` |
| `STORAGE` | Worker binding names `crypto-signal-bot-storage`; independent R2 resource inspection lacked permission |

The 2026-10-04 deployment failed because it selected the historical account, where the canonical KV namespace does not exist. Both failing main-branch GitHub Workers Builds check links pointed to the historical account. The configured canonical KV ID was correct; replacing it would have targeted different infrastructure.

`npm --prefix worker run deploy` now verifies `CLOUDFLARE_ACCOUNT_ID` before Wrangler starts. The shell release script, native Workers Builds command, CircleCI and manual GitHub release workflows use this guarded path. Missing, historical, unknown or malformed account selections fail before upload or resource mutation. The check is inside the deploy command and remains effective with npm lifecycle hooks disabled. Bare Wrangler commands are not covered; operators should use the repository deployment command.

Set the account variable in the **build/deployment environment**. A variable inside Wrangler `vars` or Dashboard **Runtime variables and secrets** is passed to the deployed Worker and does not select Wrangler's deployment account. The account ID is public configuration; credentials remain in owner-managed secrets or the local Wrangler OAuth login. This static target check does not verify credential permissions, infrastructure health or execution readiness. Wrangler and the subsequent smoke checks still must succeed.

A future account migration requires a reviewed update to `scripts/verify-worker-deployment-target.mjs` and verification of the replacement Worker, resources and client URLs. Do not change the target merely to make a historical build green.

Before adding this guard, 204 remote refs and 141 distinct deployment/tooling blobs were searched for canonical account validation and Cloudflare account-subdomain probes, and the retained PR patches were searched. Existing tooling required credentials and ran `wrangler whoami`, but did not reject the wrong deployment account. The existing release and deployment machinery is retained.

This change does not enable live trading or withdrawals, migrate remote data, activate candidate infrastructure, or replace Cloudflare resources. Mainnet acceptance remains a separate evidence-backed release requirement.
