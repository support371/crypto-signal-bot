# Billing-Independent Validation Policy

## Purpose

Engineering and release review must remain available when GitHub Actions billing, hosted runners, or account limits are unavailable.

CircleCI is the authoritative automatic validation provider for pull requests and branch updates. Local validation scripts use the same repository code and do not require GitHub credentials. GitHub Actions workflows are retained only as optional manual diagnostics and are never release prerequisites.

## Authoritative gate

The CircleCI context `billing-independent-release-gate` succeeds only after:

- frontend lint, tests, production build, and an enforced route-splitting
  performance budget;
- backend imports, tests, stabilization tests, lint, and repository audit;
- complete Worker and provider typechecks;
- full and isolated live-foundation tests;
- BTCC and Bitget provider tests;
- recovery, accounting, approval, dispatch, freshness, and validity tests;
- every paper, candidate, accounting, recovery, certification, and CryptoOps safety verifier;
- the isolated Bitget demo write-transport and Durable Object rate-limit
  verifiers, including their runtime-import, binding, network-client,
  live-mode, deletion, and retry prohibitions;
- clean-database and upgrade migration verification through migration 024;
- all three disabled Worker dry-run bundles, including the route-less Bitget
  trade-credential quarantine;
- committed-secret and permanent release-lock verification;
- CI-independence verification.

The aggregate gate does not deploy, provision credentials, enable mainnet, enable withdrawals, authorize execution, or call an exchange mutation endpoint.

## GitHub settings requirement

Repository rules must not require a GitHub Actions job. The required engineering context should be the CircleCI aggregate gate. The canonical Vercel project may remain separate deployment evidence, but the unrelated `v0-my-crypto-signal-bot` project and its build-rate-limit status are not application validation.

GitHub Actions workflows accept `workflow_dispatch` only. They may be run manually when GitHub service availability permits, but failure to start them is not engineering evidence and cannot block continued non-live development.

## Runtime monitoring

The legacy GitHub issue-creating monitor is manual and advisory. Runtime safety remains enforced by Worker health/readiness surfaces, Guardian controls, immutable metrics and alerts, and independent operational monitoring established during deployment certification. GitHub issue creation is not an accounting, Guardian, or execution authority.

## Release boundary

Removing GitHub billing as a dependency does not weaken release controls. A future live release still requires exact Git and deployment identities, passing authoritative validation, security and compliance reviews, eligible account ownership, independent release authorization, controlled certification, and explicit deployment and activation approval.
