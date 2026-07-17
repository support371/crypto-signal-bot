# CryptoOps Custom GPT — Disabled Candidate Integration

## Purpose

CryptoOps may inspect certification evidence for the disabled live and transfer candidates. It must not submit orders, cancel orders, approve withdrawals, manage destinations, expose credentials, or activate a release.

## Schemas

- `openapi/cryptoops-live-candidate-readonly.yaml`
- `openapi/cryptoops-withdrawals-candidate-readonly.yaml`

Both schemas contain only HTTP `GET` operations.

## Deployment prerequisite

The schema server hosts intentionally use `.example.invalid`. Do not replace a host until all of the following are true:

1. A separate candidate Worker has been deployed from an exact reviewed Git SHA.
2. The candidate uses isolated D1, R2, Durable Object, and secret bindings.
3. No production resource identifier is present in the candidate configuration.
4. The candidate has no public mutation route and no scheduled trigger.
5. CI, local migration, dry-run bundle, security, and rollback checks pass.
6. The Action authentication secret is configured in the Custom GPT interface, never in the schema or repository.
7. The exact deployed host is approved for read-only certification access.

## Action authentication

The OpenAPI documents declare `X-API-Key` authentication but contain no key value. Configure authentication only in the Custom GPT Action settings.

Do not place the operator key in:

- source code;
- an OpenAPI file;
- Vite variables;
- browser storage;
- D1, KV, or R2;
- issue or pull-request comments;
- logs or screenshots.

## Allowed operations

CryptoOps may read:

- live-candidate readiness evidence;
- live-candidate capability locks;
- transfer-candidate readiness evidence;
- transfer-candidate capability locks.

## Prohibited operations

CryptoOps must not be given an Action containing:

- `POST`, `PUT`, `PATCH`, or `DELETE`;
- order preview or order submission;
- order cancellation or replacement;
- destination creation or modification;
- deposit crediting;
- withdrawal request, approval, cancellation, or submission;
- Guardian reset;
- release activation;
- arbitrary D1 queries;
- secret or credential reads.

## Expected status

The live candidate is expected to return HTTP 503 with `liveReady=false`.

The transfer candidate is expected to return HTTP 503 with `withdrawalsReady=false` and `depositsObservationReady=false`.

Those responses are correct. They prove the artifacts remain certification-only.

## Change control

Any future schema change must pass `worker/scripts/verify-cryptoops-readonly-openapi.mjs`. A mutation operation requires a separate security design and must not be added to these schemas.
