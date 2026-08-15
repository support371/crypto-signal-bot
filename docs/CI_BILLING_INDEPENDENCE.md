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
- the isolated Bitget demo write-transport, Durable Object rate-limit,
  immutable reviewed-dispatch, source-only certification-runner, and immutable
  certification-evidence verifiers, including their runtime-import, binding,
  default-network-client, live-mode, deletion, credential-binding, multi-use
  credential-callback, recovery-replay, and retry prohibitions;
- clean-database and upgrade migration verification through migration 026;
- all three disabled Worker dry-run bundles, including the route-less Bitget
  trade-credential quarantine;
- committed-secret and permanent release-lock verification;
- CI-independence verification.

The aggregate gate does not deploy, provision credentials, enable mainnet, enable withdrawals, authorize execution, or call an exchange mutation endpoint.

## GitHub settings requirement

Repository rules must not require a GitHub Actions job. The required engineering context should be the CircleCI aggregate gate. The canonical Vercel project may remain separate deployment evidence, but the unrelated `v0-my-crypto-signal-bot` project and its build-rate-limit status are not application validation.

GitHub Actions workflows accept `workflow_dispatch` only. They may be run manually when GitHub service availability permits, but failure to start them is not engineering evidence and cannot block continued non-live development.

## Billing-independent Worker deployment

CircleCI also defines an opt-in `deploy-paper-worker-manual` workflow. It is disabled by default and runs only when an owner starts a pipeline on `main` with the boolean pipeline parameter `deploy_paper_worker=true`.

An authenticated repository maintainer may alternatively create the exact branch `release/paper-worker-<7-character-main-SHA>`. The release job fetches `origin/main`, requires the release branch commit to equal the current main commit, and rejects every other branch name. This provides a reviewable one-commit manual trigger when the CircleCI API is not connected.

Before deployment, the job reruns the Worker and provider typechecks, foundation and provider suites, paper/regulated/certification safety gates, migrations, and a Wrangler dry-run bundle. It then deploys the existing paper Worker and runs the public smoke checks. The job does not enable live trading, mainnet, withdrawals, provider mutation, or real funds.

The CircleCI project must hold `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as masked project environment variables or in an owner-managed restricted context. Never place either value in repository files, pipeline parameters, job output, or chat messages.

## Runtime monitoring

The legacy GitHub issue-creating monitor is manual and advisory. Runtime safety remains enforced by Worker health/readiness surfaces, Guardian controls, immutable metrics and alerts, and independent operational monitoring established during deployment certification. GitHub issue creation is not an accounting, Guardian, or execution authority.

## Release boundary

Removing GitHub billing as a dependency does not weaken release controls. A future live release still requires exact Git and deployment identities, passing authoritative validation, security and compliance reviews, eligible account ownership, independent release authorization, controlled certification, and explicit deployment and activation approval.
