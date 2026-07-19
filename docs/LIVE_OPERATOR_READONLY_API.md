# Live Candidate Operator API — Read Only

## Status

This API exposes sanitized operational evidence from the disabled live-candidate Worker. It does not enable trading, cancellation, deposits, transfers, withdrawals, reconciliation execution, accounting dispatch, reservation settlement, Guardian mutation, credential provisioning, deployment, demo requests, or release activation.

Every operator route accepts only `GET`, `HEAD`, and CORS `OPTIONS`. Other methods return HTTP 403.

## Authentication

Operator reads require both:

- `X-Operator-Id`: the actor ID used by `live_actor_roles`;
- `X-API-Key` or `Authorization: Bearer ...`: a per-operator secret whose SHA-256 digest is present in the Worker secret `OPERATOR_API_KEY_HASHES`.

`OPERATOR_API_KEY_HASHES` is a JSON object mapping actor IDs to lowercase 64-character SHA-256 digests. Raw operator secrets are not stored in source, D1, responses, logs, or the configuration file.

Authentication fails closed:

- HTTP 503 when no valid operator-key mapping is configured;
- HTTP 401 for missing or invalid credentials;
- HTTP 403 when the actor has no active allowed role in global, Bitget exchange, or requested account scope.

Roles are loaded from `live_actor_roles`. Expired and revoked assignments are rejected.

## Routes

### `GET /v1/operator/activation-gate`

Requires a global `RISK_ADMIN`, `AUDITOR`, or `RELEASE_ADMIN` role.

Returns release-readiness evidence plus permanent candidate flags:

- `activationEnabled: false`;
- `activationBlocked: true`;
- `realMoneyMovementAllowed: false`.

The response cannot activate the candidate.

### `GET /v1/operator/deployment-readiness`

Requires a global `RISK_ADMIN`, `AUDITOR`, or `RELEASE_ADMIN` role.

Returns the latest sanitized migration-028 Bitget demo deployment-readiness summary:

- status and review-readiness boolean;
- total, passed, and blocked check counts;
- bounded blocker reasons;
- external read-only attestation presence;
- exact Git SHA and preparation timestamps;
- permanent false deployment, demo-request, credential-read, provider-mutation, execution, mainnet, withdrawal, retry, and automatic-accounting capabilities.

It does not expose manifest IDs, attestation IDs, preparer IDs, resource evidence hashes, secret names, provider payloads, or callable adapters. Corrupt stored capability flags force the response to `BLOCKED` with `stored_capability_lock_violation`.

### `GET /v1/operator/certification?account_id=...&product_id=...`

Returns the latest sanitized Bitget read-only certification run, all mandatory check statuses, counts, evidence hashes, and source attestation summary.

It excludes raw balances, order payloads, fill payloads, user identifiers other than the attesting operator ID, and credentials.

### `GET /v1/operator/recovery-readiness?account_id=...&product_id=...`

Returns the latest immutable attested-recovery readiness checkpoint, counts, state, reasons, freshness timestamps, and incident/review requirements.

It does not dispatch accounting, settle reservations, or run reconciliation.

### `GET /v1/operator/reconciliation?account_id=...&product_id=...`

Returns the latest accounting reconciliation summary, exact reconstructed values, status, reasons, evidence hash, and observation time.

It does not execute reconciliation or mutate provider state.

### `GET /v1/operator/alerts?account_id=...&limit=...`

Returns at most 50 open or acknowledged account/global alerts. Alert detail JSON is intentionally excluded.

The route cannot acknowledge, suppress, resolve, or act on an alert.

### `GET /v1/operator/audit-head?account_id=...`

Requires `RISK_ADMIN`, `AUDITOR`, or `RELEASE_ADMIN` authority in scope.

Returns only the latest audit-chain identity, predecessor hash, event hash, resource identity, outcome, and timestamp. Audit before/after payloads are intentionally excluded.

## HTTP contract

The production Worker delegates operator requests to `operator-read-http.ts`; tests call that same router with real `Request` and `Response` objects. Required validation covers:

- all seven GET routes;
- `HEAD` response-body suppression;
- exact-origin CORS and a `GET, HEAD, OPTIONS` allowlist;
- HTTP 503, 401, 403, 400, and 404 fail-closed cases;
- global, exchange, and account role boundaries;
- mutation denial before any provider or evidence action;
- permanent non-live capability flags;
- deployment-readiness response minimization.

## Data minimization

The operator read model does not query or expose:

- exchange credentials, signing material, passphrases, or private keys;
- deposit or withdrawal addresses;
- raw balance snapshots;
- raw exchange order or fill JSON;
- audit before/after JSON;
- browser-stored authority;
- callable exchange transport.

## Safety contract

CI fails if the operator modules acquire:

- D1 `INSERT`, `UPDATE`, or `DELETE` operations;
- exchange fetch or signing code;
- non-GET operator methods;
- direct Guardian halt/reset calls;
- provider mutation, execution, withdrawal, deployment, demo-request, credential-read, or activation flags set to true;
- raw financial or audit payload queries;
- divergence between the Worker entrypoint and the tested production router.

The live-candidate PR must remain draft until all independent engineering, deployment, security, eligibility, legal, compliance, and release-certification gates are satisfied by authorized parties.
