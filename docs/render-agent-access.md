# Render Agent Access

This guide explains safe ways to let an execution agent inspect and manage the Render backend for `crypto-signal-bot` without sharing secrets in chat or committing credentials.

## Recommended option: Render MCP

Render provides a hosted MCP server for compatible AI tools. Use it when your agent environment supports MCP. The server URL is:

```text
https://mcp.render.com/mcp
```

Render MCP is designed for agent workflows such as listing services, inspecting logs and metrics, and modifying an existing service's environment variables. Render API keys are broadly scoped, so only connect this to a trusted tool and store the key in the tool's secure configuration, never in the repository.

### Cursor example

Create or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "render": {
      "url": "https://mcp.render.com/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_RENDER_API_KEY>"
      }
    }
  }
}
```

### Codex-style example

Add a Render MCP server entry to your local Codex MCP configuration:

```toml
[mcp_servers.render]
url = "https://mcp.render.com/mcp"

[mcp_servers.render.headers]
Authorization = "Bearer <YOUR_RENDER_API_KEY>"
```

Do not paste the real key into normal chat. Store it only in your local agent config or secret manager.

## Repo helper: `scripts/render_manage.py`

This repository also includes a small dependency-free Python helper that talks to Render's REST API using `RENDER_API_KEY` from your shell environment.

```bash
export RENDER_API_KEY=...
python scripts/render_manage.py list-services
python scripts/render_manage.py find-service crypto-signal-bot
python scripts/render_manage.py health
```

The helper can check health without an API key:

```bash
python scripts/render_manage.py health
```

Find the service ID:

```bash
RENDER_API_KEY=... python scripts/render_manage.py find-service crypto-signal-bot
```

Inspect recent deploys:

```bash
RENDER_API_KEY=... python scripts/render_manage.py deploys <service-id>
```

List environment variables with likely secret values redacted:

```bash
RENDER_API_KEY=... python scripts/render_manage.py env-vars <service-id>
```

Set an allowlisted paper/demo deployment variable:

```bash
RENDER_API_KEY=... python scripts/render_manage.py set-env <service-id> CORS_ALLOWED_ORIGINS https://crypto-signal-bot-indol.vercel.app --confirm
```

Trigger a deploy:

```bash
RENDER_API_KEY=... python scripts/render_manage.py create-deploy <service-id> --confirm
```

The helper intentionally refuses to manage live-trading variables or exchange credentials. Live mode must remain a deliberate, manually reviewed change.

## Current Render backend values

For the current paper/demo deployment, use:

```env
TRADING_MODE=paper
CORS_ALLOWED_ORIGINS=https://crypto-signal-bot-indol.vercel.app
EVENT_LOG_ENABLED=true
EVENT_LOG_PATH=/tmp/crypto-signal-bot/event_log.db
AUDIT_STORE_PATH=/tmp/crypto-signal-bot/audit.json
EARNINGS_STORE_PATH=/tmp/crypto-signal-bot/earnings.json
BACKEND_API_KEY=<long-random-private-value>
```

Older docs or configs might mention `CORS_ORIGINS`; verify the active backend config. The latest deployment brief uses `CORS_ALLOWED_ORIGINS` as the correct variable.

## Safe workflow for agents

1. Create a Render API key in Render dashboard account settings.
2. Store it in your MCP config or local shell as `RENDER_API_KEY`.
3. Run:

   ```bash
   python scripts/render_manage.py diagnose
   ```

4. If the health check fails, inspect service deploys and logs through MCP or the Render dashboard.
5. Patch repository files only for code/config issues.
6. Do not commit API keys, service secrets, exchange credentials, or live-trading confirmations.

## Manual setup if no agent tooling is available

1. Render → backend service → Environment.
2. Add or update `CORS_ALLOWED_ORIGINS` with `https://crypto-signal-bot-indol.vercel.app`.
3. Confirm `TRADING_MODE=paper`.
4. Confirm event/audit paths point to `/tmp/crypto-signal-bot/...` on free Render services.
5. Manual Deploy → Deploy latest commit.
6. Verify:

   ```bash
   curl -sS https://crypto-signal-bot-deqd.onrender.com/health
   ```

## Security notes

- Render API keys can access all workspaces/services your account can access.
- Revoke a key immediately if it is exposed.
- Never put `RENDER_API_KEY` in `.env` files committed to git.
- Never use this helper to configure live trading or exchange credentials.
- Keep `TRADING_MODE=paper` until testnet/live validation is explicitly requested.
