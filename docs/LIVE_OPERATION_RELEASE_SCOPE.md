# Live operation release scope

`worker/src/live/live-operation-release-policy.ts` evaluates persisted release
scope for a specific PLACE or CANCEL operation. It checks the exact release,
source SHA, Worker/frontend deployments, schema, provider, account hash, product
allowlist, canonical validity window and recorded security/compliance reviews.
PLACE also requires positive conservative quote notional, the per-order ceiling,
and account/provider/current-UTC-day bound used-plus-reserved daily exposure.
Amounts use exact decimal arithmetic. CANCEL allocates no additional capital;
it still requires matching current release scope and cannot carry order notional.

This is a source-only policy dependency for the future executable artifact.
It does not import into a Worker entrypoint, read credentials, send a request,
claim a dispatch attempt or enable a deployment. A passing report explicitly
keeps execution and withdrawals false and cannot serve as an execution token.

The eventual account coordinator must load these inputs from trusted current
storage rather than HTTP payloads. It must recheck current trader/step-up,
Guardian, risk, reservation and externally certified provider/account model,
then atomically claim the attempt and applicable daily exposure. Ambiguous
attempts remain counted until reconciled; they cannot free daily capacity or
trigger automatic mutation retry. Release scope is one prerequisite, not proof
that those other controls have run.

On 2026-10-04, eight focused tests passed for exact boundaries, deployment and
account mismatch, sub-floating-point overspend, missing/stale daily exposure,
malformed limits, revocation/expiry, cancellation and candidate artifact rejection.
Worker TypeScript compilation passed. Mainnet activation remains incomplete.

Credential discovery found declared Cloudflare Secrets Store
`077d4599269544239a34ade0f64d2f48`. Certification names are
`BITGET_CERT_API_KEY`, `BITGET_CERT_API_SECRET`, `BITGET_CERT_API_PASSPHRASE`;
trade names use the `BITGET_TRADE_` prefix. These references do not prove the
secrets exist. Both local and GEM-ASSIST repo environment templates were empty;
the existing OAuth login received HTTP 403 for store metadata. Actual secrets,
Classic/UTA account model and external provider certification remain unverified.
