# Agent build command trigger

This repository supports one guarded entry point for diagnosis, builds, tests, and local coding-agent work without enabling deployment or live trading.

## What the flow does

1. A GitHub issue or pull-request comment can request a validation scope.
2. GitHub Actions checks out the requested ref and runs the guarded PowerShell launcher.
3. The workflow returns a copyable terminal command and the validation result.
4. The same launcher can optionally hand a task to Codex on the operator's computer.
5. Codex is restricted to workspace writes, asks for approval when required, and leaves changes uncommitted for review.

The workflow itself never invokes a paid model API and does not require an OpenAI API key. Agent execution occurs locally through the signed-in Codex CLI when `-UseCodex` is selected.

## Activation requirement

The trigger file must be present on the repository's default branch before GitHub accepts `workflow_dispatch` or `issue_comment` events. Merge the reviewed pull request containing:

- `.github/workflows/agent-build-trigger.yml`
- `scripts/agent-build.ps1`
- `docs/AGENT_BUILD_TRIGGER.md`

Do not bypass branch protection or merge without the normal project review.

## GitHub trigger

On an issue or pull request, add one of these comments:

```text
/agent-build diagnose
/agent-build frontend Fix the failing frontend build
/agent-build backend Reproduce and correct the API test failure
/agent-build worker Verify the paper-safety and Worker tests
/agent-build full Locate the first reproducible release-gate failure
```

Allowed scopes:

- `diagnose`: repository, CI-independence, release-lock, and current-ref checks
- `frontend`: lint, TypeScript, Vitest, and production build
- `backend`: isolated Python environment, compile checks, backend tests, and repository audit
- `worker`: Worker TypeScript, paper-safety verification, and Worker tests
- `full`: all scopes in sequence

Only a comment made by the repository owner can start the issue-comment route. Other comments do not start a job. Validation has read-only repository permissions and checks out code without persisted Git credentials. A separate job receives issue-write permission only to post the final result and never executes repository code.

The workflow can also be started manually from **GitHub → Actions → Agent Build Command Trigger → Run workflow**, where a ref, scope, and task can be selected.

## Direct Windows terminal flow

Prerequisites:

- Git
- Node.js 22.12.0 or later; Node 22.x is the verified line
- Python 3.11
- PowerShell 7 recommended

Run:

```powershell
git clone https://github.com/support371/crypto-signal-bot.git
cd crypto-signal-bot
git fetch --all --prune
git checkout main
.\scripts\agent-build.ps1 -Scope diagnose
```

To run the complete local validation:

```powershell
.\scripts\agent-build.ps1 -Scope full
```

The launcher creates `.venv-agent` for backend dependencies. It uses `npm ci` for deterministic Node installations. Add `-SkipInstall` only when the required dependencies are already installed and unchanged.

## Codex terminal agent flow

Install or update the Codex CLI:

```powershell
npm install -g @openai/codex
codex --version
```

Sign in through Codex when prompted. Then run:

```powershell
$task = @'
Locate the first reproducible build or test failure in the selected scope. Make the smallest safe correction, run the relevant tests, and leave the changes uncommitted for review.
'@

.\scripts\agent-build.ps1 -Scope full -Task $task -UseCodex
```

The launcher starts Codex with:

- repository root as the working directory
- `workspace-write` sandbox
- `on-request` approval policy
- ephemeral execution history for the task
- user configuration ignored for the one-shot run, so local defaults cannot loosen the repository safety contract
- plugin loading disabled for the one-shot run, preventing unrelated plugin synchronization or workspace scaffolding
- the repository `AGENTS.md` safety contract

It does not use danger-full-access, load user-level execution defaults, enable plugins, or bypass approval and sandbox controls. Authentication remains available even though user configuration is ignored.

## Permanent safety boundaries

Every route sets and verifies:

```text
TRADING_MODE=paper
EXCHANGE_MODE=paper
NETWORK=testnet
ALLOW_MAINNET=false
```

The flow does not:

- deploy to Cloudflare, Vercel, Render, or another provider
- merge or promote a branch
- run remote D1 migrations
- expose or create credentials
- connect exchange write keys
- place live orders
- transfer funds
- enable deposits or withdrawals
- change billing or create paid resources

## GitHub Actions availability fallback

Standard GitHub-hosted runners are free for this public repository. However, an account-level GitHub Actions or runner-provisioning restriction can still cause a run to fail before any workflow step starts.

When that occurs, the repository code has not failed. Use the local PowerShell command flow above until GitHub Actions execution is restored. Do not weaken tests or safety controls to compensate for an account-level runner failure.
