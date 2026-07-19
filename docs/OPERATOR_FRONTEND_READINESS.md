# Operator Frontend Readiness — Credential-Free Trust Boundary

## Purpose

The protected `/operator-readiness` page is a read-only visualization of sanitized operator evidence. It is not an authorization mechanism and cannot activate deployment, submit or cancel orders, read exchange credentials, move funds, change Guardian state, acknowledge alerts, execute a rehearsal, or certify a release.

The browser must never possess the live-candidate Worker's operator API key or construct `X-Operator-Id`, `X-API-Key`, or `Authorization` headers for the operator control plane.

## Current state

The frontend calls only the same-origin path:

`GET /api/operator/readiness`

The request uses:

- `credentials: same-origin`;
- `cache: no-store`;
- redirect rejection;
- an `Accept: application/json` header only.

The current Vercel function at that path is deliberately fail-closed. It returns HTTP 503 with `OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED`. It does not inspect headers, cookies, request bodies, environment variables, secrets, or upstream services.

This provides an explicit unavailable state instead of allowing the browser to infer authority from a missing route or proxy failure.

## Browser capability contract

The browser accepts a snapshot only when all of the following are exact:

- environment is `live-candidate`;
- `readOnly` is true;
- an authenticated server-side operator summary is present;
- at least one server-resolved role is present;
- activation is blocked;
- live readiness is false;
- real-money movement is false;
- every deployment, demo-request, credential-read, provider-mutation, execution, live, real-funds, mainnet, withdrawal, retry, and automatic-accounting capability is false.

Any missing or unsafe field produces `invalid_response` and removes all operator, deployment, operational, and account evidence from the rendered state.

The frontend never fills missing evidence with synthetic values.

## Role-scoped rendering

The future trusted gateway must provide an explicit `visibleResources` list drawn only from:

- `ACTIVATION_GATE`;
- `DEPLOYMENT_READINESS`;
- `OPERATIONAL_REHEARSAL`;
- `CERTIFICATION`;
- `RECOVERY_READINESS`;
- `RECONCILIATION`;
- `ALERTS`;
- `AUDIT_HEAD`.

The page renders deployment evidence only when `DEPLOYMENT_READINESS` is visible and operational rehearsal evidence only when `OPERATIONAL_REHEARSAL` is visible. Account evidence must already be filtered to the server-authorized account and product scope. The browser does not calculate role permissions.

Operational rendering is limited to scenario names, pass and evidence-presence booleans, observation timestamps, counts, blockers, Git SHA, and preparation time. Evidence hashes, pack IDs, preparer IDs, raw JSON, and executable procedures are discarded or never supplied.

## Requirements for replacing the 503 placeholder

A later gateway implementation must be independently reviewed and must satisfy the full contract in `OPERATOR_IDENTITY_GATEWAY_CONTRACT.md` and `contracts/operator-readiness-response.schema.json`, including:

1. Verify a server-side identity session issued by an approved identity provider.
2. Reject unsigned, expired, revoked, replayed, wrong-audience, and wrong-issuer sessions.
3. Require approved MFA or step-up assurance.
4. Resolve operator identity and roles on the server; never trust browser-supplied actor or role headers.
5. Keep Worker read credentials in a server-only secret store with independent custody, rotation, and revocation procedures.
6. Use separate scoped requests for the eight read-only Worker resources.
7. Aggregate only sanitized response fields documented in `LIVE_OPERATOR_READONLY_API.md`.
8. Bind account and product evidence to server-resolved scope.
9. Enforce request deadlines, bounded response sizes, redirect denial, and no automatic retries.
10. Return no raw balances, orders, fills, audit payloads, evidence hashes, secret names, provider payloads, or callable adapter details.
11. Preserve all permanent false capability flags.
12. Emit auditable authentication and authorization outcomes without logging tokens or credentials.
13. Remain read-only; no POST, PUT, PATCH, or DELETE proxying.
14. Pass independent rollback and incident-containment review before deployment.

Until every requirement is implemented and independently reviewed, the endpoint must continue returning HTTP 503.

## Validation

Required frontend validation includes:

- pure normalization and fail-closed tests;
- operational scenario minimization and scope-hiding tests;
- HTTP status mapping for 401, 403, 503, and other failures;
- fixed same-origin request verification;
- source scans for browser storage, cookies, operator headers, direct Worker paths, secret environment variables, cross-origin credentials, and write methods;
- machine-readable response-schema checks;
- a static build verifier that also inspects the fail-closed gateway placeholder and identity contract;
- architecture typecheck, lint, full Vitest, Vite build, and performance verification.

## Activation status

This frontend work does not change deployment or exchange activation status. Mainnet, live execution, provider mutation, real funds, transfers, withdrawals, credential reads, automatic retry, and automatic accounting dispatch remain disabled.
