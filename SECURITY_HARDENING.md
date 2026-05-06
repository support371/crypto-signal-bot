# Production Security Hardening Runbook

## Current release posture

This project is safe-by-default only when it runs in paper mode. A production release still requires credential hygiene, HTTPS termination, origin lockdown, authenticated write endpoints, and live exchange certification.

## Required before production

### 1. Rotate exposed credentials

Rotate every exchange/API credential that may have appeared in any branch history or local artifact. Treat historical `.env` files, logs, archives, screenshots, and build bundles as compromised if they contained live values.

Required rotations:

- Binance keys
- Bitget keys
- BTCC keys
- Supabase service-role or anon keys if exposed
- `BACKEND_API_KEY`
- deployment provider tokens

### 2. Scrub repository history

Use BFG Repo-Cleaner or `git filter-repo` from a local clone. Do not attempt this from a web editor.

Minimum patterns to remove from history:

```text
*.zip
*.tar
*.gz
*.log
*.sqlite
*.sqlite3
*.db
.env
.env.*
*.pem
*.key
*.p12
*.pfx
```

After rewriting history:

```bash
git gc --prune=now --aggressive
```

Then force-push only during a planned maintenance window.

### 3. Run tracked-file hygiene checks

```bash
python scripts/security_hygiene_audit.py
python scripts/repo_audit.py
```

Both should exit `0` before release.

### 4. Lock down production origins

Production `CORS_ORIGINS` must be exact origins only. Do not use wildcards.

Good:

```env
CORS_ORIGINS=https://app.example.com
```

Bad:

```env
CORS_ORIGINS=*
```

### 5. Enforce HTTPS and security headers

Use nginx, Caddy, Traefik, or a cloud load balancer for TLS termination.

Required response headers:

```text
Content-Security-Policy
X-Frame-Options
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

### 6. Protect write endpoints

Set a strong `BACKEND_API_KEY` at minimum. For multi-user production, replace operator-key-only access with backend JWT verification tied to Supabase or your identity provider.

### 7. Test guardian controls

Before enabling live trading:

```bash
curl -X POST "$BACKEND_URL/kill-switch" \
  -H "X-API-Key: $BACKEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"activate": true, "reason": "pre-launch control test"}'
```

Verify `/health` and `/guardian/status` show the kill switch as active.

### 8. Certify testnet first

Mainnet is blocked until testnet smoke tests pass for the selected execution exchange.

```bash
make testnet-smoke-dry
make testnet-smoke
```

## Release gate

Do not approve mainnet unless all are true:

- tracked-file hygiene audit exits `0`
- repo audit exits `0`
- backend tests pass except explicitly documented pre-existing integration-only failures
- frontend build succeeds
- HTTPS backend origin is configured
- exact CORS origin is configured
- write endpoint auth is active
- kill switch test passed
- selected exchange testnet certification passed
- exposed credentials have been rotated
