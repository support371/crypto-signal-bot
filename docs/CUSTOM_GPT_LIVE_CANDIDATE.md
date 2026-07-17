# CryptoOps Custom GPT — Read-Only Integration

## Purpose

CryptoOps is a read-only operational and release-evidence assistant for this project. It may inspect current runtime, repository, CI, deployment inventory, and disabled candidate evidence. It must not submit orders, cancel orders, approve withdrawals, manage destinations, reset Guardian state, deploy code, modify repository state, expose credentials, or activate a release.

## Schema sets

### Canonical operational schemas

These schemas point to current public provider APIs or the canonical production Worker:

- `gpt-actions/url/cryptoops-worker-readonly.yaml`
- `gpt-actions/url/cryptoops-github-readonly.yaml`
- `gpt-actions/url/cryptoops-cloudflare-readonly.yaml`
- `gpt-actions/url/CRYPTOOPS_GPT_MASTER_INSTRUCTIONS.md`
- `gpt-actions/url/privacy-policy.html`

They provide read-only evidence for paper-production health, readiness, runtime flags, Guardian state, paper orders and portfolio, repository contents, pull requests, current commit checks, workflow runs, and infrastructure inventory.

### Disabled candidate schemas

These schemas expose certification-only evidence for undeployed candidates:

- `openapi/cryptoops-live-candidate-readonly.yaml`
- `openapi/cryptoops-withdrawals-candidate-readonly.yaml`

Their server hosts intentionally use `.example.invalid`. Do not replace a host until a separately isolated candidate deployment has completed review and certification.

Every published schema contains only HTTP `GET` operations.

## Deployment prerequisite for candidate schemas

Do not replace a candidate placeholder host until all of the following are true:

1. A separate candidate Worker has been deployed from an exact reviewed Git SHA.
2. The candidate uses isolated D1, R2, Durable Object, Queue, and secret bindings.
3. No production resource identifier is present in the candidate configuration.
4. The candidate has no public mutation route and no scheduled financial trigger.
5. CI, local migration, dry-run bundle, security, and rollback checks pass.
6. Action authentication is configured in the Custom GPT interface, never in a schema or repository file.
7. The exact deployed host is approved for read-only certification access.

## Action authentication

The OpenAPI documents declare provider or `X-API-Key` authentication without containing credential values. Configure authentication only in the Custom GPT Action settings.

Do not place credentials in:

- source code;
- an OpenAPI file;
- Vite variables;
- browser storage;
- D1, KV, or R2;
- issue or pull-request comments;
- logs or screenshots.

## Allowed operations

CryptoOps may read:

- production Worker health, readiness, runtime, Guardian, feed, portfolio, paper-order, and audit evidence;
- repository, branch, commit, pull-request, changed-file, check-run, and workflow-run evidence;
- Cloudflare resource inventory metadata;
- live-candidate readiness and capability locks;
- transfer-candidate readiness and capability locks.

## Prohibited operations

CryptoOps must not be given an Action containing:

- `POST`, `PUT`, `PATCH`, `DELETE`, or `TRACE`;
- order preview or submission;
- order cancellation or replacement;
- destination creation or modification;
- deposit crediting;
- withdrawal request, approval, cancellation, or submission;
- Guardian halt or reset;
- release activation;
- workflow dispatch;
- repository writes;
- arbitrary D1 queries;
- secret or credential reads.

## Expected candidate status

The live candidate is expected to return HTTP 503 with `liveReady=false`.

The transfer candidate is expected to return HTTP 503 with `withdrawalsReady=false` and `depositsObservationReady=false`.

Those responses are correct. They prove the artifacts remain certification-only.

## Automated enforcement

Candidate schemas are enforced by:

- `worker/scripts/verify-cryptoops-readonly-openapi.mjs`
- `.github/workflows/cryptoops-readonly-openapi.yml`

Canonical operational schemas and policies are enforced by:

- `scripts/verify-cryptoops-readonly-openapi.mjs`
- `.github/workflows/cryptoops-readonly.yml`

A mutation operation requires a separate security design and must not be added to either schema set.
