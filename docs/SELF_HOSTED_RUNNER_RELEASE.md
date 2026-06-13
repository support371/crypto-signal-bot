# Self-Hosted Runner Release Lane

## Why this exists

The current GitHub-hosted Actions jobs are blocked by a GitHub account or billing lock. Recent GitHub-hosted jobs could not start because they depend on GitHub-hosted runners such as `ubuntu-latest`.

This document describes a safe parallel release lane that uses a self-hosted runner instead of GitHub-hosted runners.

## Scope

This is a parallel release lane, not a replacement for the existing workflows.

Existing GitHub-hosted workflows remain in place. They should not be deleted as part of this change.

The new workflow is manual only and must not deploy automatically.

## Workflow

Workflow file:

```text
.github/workflows/self-hosted-release.yml
```

Workflow name:

```text
self-hosted-release
```

Trigger:

```text
workflow_dispatch only
```

The first run should use:

```text
deploy_worker=false
update_vercel=false
```

## Required runner labels

The self-hosted runner must have all of these labels:

- `self-hosted`
- `cryptoops`
- `linux`

The workflow uses:

```yaml
runs-on: [self-hosted, cryptoops, linux]
```

## Required installed tools

The self-hosted runner should have these tools installed and available on `PATH`:

- `git`
- Node.js 22
- `npm`
- Python 3.11
- `pip`
- `wrangler`
- Vercel CLI, only if Vercel deploy is used

The workflow also uses official setup actions for Node.js 22 and Python 3.11, but the self-hosted runner must still be maintained and patched by the project operator.

## Required GitHub Secrets

Use these GitHub Secrets names only. Do not commit values.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID`

Secrets must be configured in GitHub repository or organization settings, never in code, docs, workflow logs, commits, or chat messages.

## Safety rules

Live trading remains disabled.

Withdrawals remain disabled.

The workflow sets and verifies:

```text
TRADING_MODE=paper
EXCHANGE_MODE=paper
ALLOW_MAINNET=false
```

The workflow must not remove or bypass:

- Guardian checks
- Circuit breakers
- Paper-safety checks
- Audit logging
- Safety verification routes
- `/intent/live` block checks
- `/withdraw` block checks

## Validation behavior

The self-hosted release lane validates the app before any optional deployment step:

1. Checks out the repository.
2. Sets up Node.js 22.
3. Sets up Python 3.11.
4. Installs frontend dependencies with `npm ci`.
5. Builds the frontend with `VITE_BACKEND_URL=/api` and `VITE_API_BASE_URL=/api`.
6. Verifies `dist/index.html` exists.
7. Verifies `dist/assets` exists.
8. Installs backend Python dependencies only if `backend/requirements.txt` exists.
9. Compiles backend imports with `python -m py_compile backend/app.py backend/public_app.py`.
10. Runs backend tests with `python -m pytest backend/tests/ -x -q`.
11. Runs `python scripts/repo_audit.py`.
12. Installs Worker dependencies with `cd worker && npm ci`.
13. Builds the Worker with `cd worker && npm run build`.
14. Verifies paper safety with `cd worker && npm run verify:paper-safety`.
15. Validates the Wrangler bundle with a dry run before deployment.
16. Deploys the Cloudflare Worker only when `deploy_worker=true`.
17. Smoke checks Worker endpoints only after deploy.
18. Updates Vercel only when `deploy_worker=true` and `update_vercel=true`.

## Deployment behavior

Deployment is manual and disabled by default.

Default workflow inputs:

```text
deploy_worker=false
update_vercel=false
```

Cloudflare deploy must not happen unless:

```text
deploy_worker=true
```

Vercel update must not happen unless:

```text
deploy_worker=true
update_vercel=true
```

Do not trigger this workflow automatically.

Do not run the deploy path during setup.

## Manual test instruction

In GitHub:

```text
GitHub Actions → self-hosted-release → Run workflow
```

For the first run, use:

```text
deploy_worker=false
update_vercel=false
```

This first run should validate the release lane without deploying the Worker or updating Vercel.

## Operator notes

The self-hosted runner must be trusted, patched, and controlled by the project owner.

Do not print secrets in logs.

Do not paste real token values into issues, pull requests, workflow files, documentation, or chat.

If any token is exposed, rotate it immediately on the source platform.
