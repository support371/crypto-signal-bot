# Trusted Operator Identity Gateway Contract

## Status

The same-origin endpoint `/api/operator/readiness` remains intentionally unconfigured and returns HTTP 503. This document defines the minimum contract for a later independently reviewed replacement. It does not authorize implementation, deployment, credential provisioning, provider access, or release activation.

## Trust boundary

The browser is an untrusted presentation client. It must not provide or store:

- operator API keys;
- Worker secrets;
- exchange credentials;
- trusted actor IDs or role claims;
- authorization evidence;
- provider payloads;
- deployment authority.

The gateway must derive identity, assurance, roles, and data scope from a server-verified session. Browser-supplied `X-Operator-Id`, `X-API-Key`, `Authorization`, role, account, product, or environment claims must not become authority.

## Required session verification

A replacement gateway must verify all of the following before reading any Worker evidence:

1. The session is cryptographically verified by an approved identity provider.
2. Issuer and audience are exact and configured server-side.
3. The session is not expired, revoked, replayed, or outside its allowed clock skew.
4. Multi-factor or step-up assurance satisfies the operator-read policy.
5. The subject maps to one server-side operator identity.
6. Active roles are resolved server-side and checked for expiry and revocation.
7. Account and product scope are derived server-side; query parameters cannot expand scope.
8. Authentication and authorization outcomes are auditable without logging tokens, cookies, secrets, or raw identity assertions.

Any failed or unavailable check must return 401, 403, or 503 without partial evidence.

## Read-only aggregation

The gateway may aggregate only the following Worker resources:

- `ACTIVATION_GATE`;
- `DEPLOYMENT_READINESS`;
- `OPERATIONAL_REHEARSAL`;
- `CERTIFICATION`;
- `RECOVERY_READINESS`;
- `RECONCILIATION`;
- `ALERTS`;
- `AUDIT_HEAD`.

Every upstream request must be independently authorized for the server-resolved operator and scope. The gateway must not infer one resource's authorization from another.

Required transport controls:

- GET or HEAD only;
- exact approved Worker origin;
- redirect denial;
- bounded deadline and response size;
- no automatic retry;
- no cross-account fan-out unless the role explicitly permits each account;
- no provider network calls;
- no exchange credential access;
- no mutation endpoint proxying.

## Response minimization

A successful response may contain only:

- generation timestamp;
- `live-candidate` environment marker;
- read-only marker;
- sanitized operator identity and matched-role names;
- explicit visible-resource list;
- blocked activation summary;
- deployment-readiness status, counts, blockers, external-attestation presence, Git SHA, and timestamps;
- operational-rehearsal status, counts, scenario names, pass/evidence-presence booleans, observation times, blockers, Git SHA, and preparation time;
- account-scoped certification, recovery, reconciliation, alert-count, and audit-head summaries;
- permanent false capability locks.

The response must not contain:

- session tokens or cookies;
- identity-provider assertions;
- operator or Worker secrets;
- manifest, attestation, rehearsal-pack, preparer, or internal operation IDs;
- evidence hashes;
- raw balances, orders, fills, audit payloads, or provider JSON;
- secret names, deployment tokens, or callable adapter details.

## Permanent capability contract

Every successful response must state exactly:

- `deploymentAllowed = false`;
- `demoRequestAllowed = false`;
- `credentialsRead = false`;
- `providerMutationAllowed = false`;
- `executionAllowed = false`;
- `liveExecutionAllowed = false`;
- `realFundsAllowed = false`;
- `mainnetAllowed = false`;
- `withdrawalsAllowed = false`;
- `automaticRetryAllowed = false`;
- `accountingAutomaticallyDispatched = false`.

The frontend rejects the full response if any capability is missing or true.

## HTTP behavior

- `GET`: return the sanitized snapshot or a fail-closed error.
- `HEAD`: return the same status and headers with no body.
- `OPTIONS`: exact same-origin preflight for GET and HEAD only.
- `POST`, `PUT`, `PATCH`, and `DELETE`: return 405 and perform no reads or writes.
- Never redirect to an identity provider from the API route; interactive sign-in belongs to a separate reviewed application flow.

## Replacement gate

The current 503 placeholder may be replaced only after all of these are independently reviewed and evidenced:

- approved identity provider and exact issuer/audience configuration;
- MFA or step-up assurance policy;
- session revocation and replay controls;
- server-side role and scope resolution;
- server-only custody and rotation of Worker read credentials;
- bounded, no-retry read aggregation;
- response minimization tests;
- 401, 403, 405, and 503 failure tests;
- audit-log privacy tests;
- incident rollback procedure;
- exact code and deployment identity review.

Passing this gate permits only a read-only operator interface. It does not permit a Bitget demo request, provider mutation, live execution, mainnet, real funds, transfers, withdrawals, or release activation.
