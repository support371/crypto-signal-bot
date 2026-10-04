# Private Bitget read-only certification service

`wrangler.provider-certification.toml` builds an isolated service with no public
routes, workers.dev URL, preview URLs or triggers. It has only the three actual
Secrets Store certification bindings. It has no D1/KV/R2 binding, trade key,
order transport, account coordinator or automatic evidence persistence.

This is prepared source, not a currently deployed or externally verified service.
The runtime entrypoint injects Cloudflare fetch and Date.now. Tests inject local
fixtures; their passing results are not external provider evidence.

## Deployment prerequisites

1. Verify canonical account `d944e40760494a6843e521cd57c15dfd` and metadata for
   all three certification secret names with Workers scope. The store is
   `b5f2c2cdae2c445b8ead1ceda7620fed`.
2. Generate `CERTIFICATION_RUNNER_TOKEN` securely during deployment and bind it
   as a Worker secret. The engineer generates it; it is not another Bitget key
   the owner must supply. Never put it into source, a frontend variable or logs.
3. Publish only this isolated artifact after local acceptance and resource
   checks. No public route or production paper binding is required.
4. Invoke through a protected service-binding caller or an authenticated remote
   Wrangler development session using the same token. Do not expose a public
   financial or credential-inspection endpoint to make invocation easier.

`npm --prefix worker run verify:provider-certification-resources` validates this
exact artifact's private exposure, non-financial bindings, disabled flags and
canonical-account secret metadata. `deploy:provider-certification` runs that
preflight before Wrangler. It does not generate the invocation token, claim that
the token is bound, or certify the provider. Configure the engineer-generated
token securely and inspect its deployed binding before invoking.

## Internal request contracts

Both operations require `Authorization: Bearer <CERTIFICATION_RUNNER_TOKEN>`.
Failed authentication is rejected before command reading, secret values or fetch.

`POST /internal/bitget/inspect` performs one GET to account info, verifies a
read-only key and returns only a hashed provider UID and permission summary.
The `accountRefHash` is `canonicalHash(userId)`; it is not an arbitrary supplied
account identifier. Raw UID, signing material and headers are never returned.

`POST /internal/bitget/certify` accepts exactly:

```json
{
  "runId": "unique-certification-run",
  "exchangeAccountId": "internal-reviewed-account-id",
  "expectedAccountRefHash": "<64 lowercase hex characters from inspection>",
  "productId": "BTC-USDT"
}
```

The expected hash must match authenticated account info before balances/orders
are requested. The command is bounded to 2 KiB and three seconds. Only a
one-hour historical window is used; the caller cannot select a provider host,
endpoint, method, query, credential or clock. Each credential is read once per
invocation, with a bounded Secrets Store deadline, then retained only in
request-local material. Provider bodies are bounded to 128 KiB, calls to eight
seconds and the completed run to 65 seconds. All six outbound calls use GET.

The service currently supports reviewed `stor` and `taxr` read permissions and
requires `stor`. Additional authority codes require contract review even if they
do not appear in the known write-permission denylist. Provider success envelopes
must contain `code=00000`; missing success evidence is rejected.

The result contains all eight contract checks, hashes, counts and measured run
duration. FAILED or BLOCKED checks remain visible; upstream messages and secret
values do not enter returned errors. A saturated page stays BLOCKED.

## Remaining acceptance

Successful reads through v2 cannot establish whether the actual account is
Classic or UTA. Every response keeps `accountModel=UNVERIFIED`,
`accountModelVerified=false`, `certifiedForLive=false`, and execution, transfer
and withdrawals false. Explicit account-model evidence and any required UTA
adapter remain separate work. No external attestation is inferred automatically
and this service cannot project results into a live release or make an account
READY. Persisting a passed run still requires the reviewed source/authorization
attestation workflow.

On 2026-10-04 GEM-ASSIST reconnected. Wrangler confirmed the Analyzer account;
after refreshing its cached OAuth session, an authenticated metadata-only API
read returned success with total_count=0 for the configured credential store.
All three certification secret names were absent. No secret values were read,
and the credential preflight correctly blocked deployment. This service remains
prepared source; no external certification request or mainnet activation ran.
