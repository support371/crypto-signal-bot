# Provider credential store preflight

The full candidate resource CLI now checks the three certification Secrets Store
bindings after storage inspection. `npm --prefix worker run
verify:provider-secret-store` runs this metadata check independently. The private
projection profile needs no exchange credentials and does not run this check.

The checker requires canonical account selection and an API credential with
Secrets Store inspection access. It validates exact binding/secret names and one
non-placeholder store ID, inspects bounded paginated metadata using GET only,
and requires all three names to have the `workers` scope. It never requests
secret values, provisions resources or treats name existence as provider
certification. Missing store, access denial and missing secret names are separate
redacted errors. Streaming and fetch deadlines remain bounded even if an injected
fetch implementation ignores abort signals. Ambiguous pagination, duplicate names
and oversized responses cannot pass.

Authenticated inspection on 2026-10-04 confirmed the canonical account
`d944e40760494a6843e521cd57c15dfd` has zero Secrets Stores
(`page=1`, `per_page=100`, `count=0`, `total_count=0`). The checked-in store ID
`077d4599269544239a34ade0f64d2f48` returned HTTP 404 after OAuth access was
renewed with `secrets_store:write`. The historical account returned HTTP 403;
its store ownership is unverified. No secret store was created or deleted during that inspection.

Therefore certification credentials are not available through the declared
canonical store. Correct provisioning requires actual owner-supplied provider
credentials via a secure channel and independently verified read-only permission
and account identity/model. Empty repo templates, trade credential names and
passing fixture tests cannot substitute for that evidence. External certification,
the live executable runtime and real-money activation remain incomplete.

Subsequent provisioning created and verified canonical store
`b5f2c2cdae2c445b8ead1ceda7620fed` (`crypto-signal-bot-provider-credentials`).
The source configs now reference it, and the store is empty pending secure owner
entry. See PROVIDER_CREDENTIAL_PROVISIONING.md for the direct dashboard URL and
exact names. This changes store readiness, not provider certification or activation.
