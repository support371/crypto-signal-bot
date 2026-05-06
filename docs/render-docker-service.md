# Render Docker Backend Service

## Purpose

Use this path when Render created the backend as a Docker service.

## Dockerfile path

Set Render Dockerfile path to:

```text
Dockerfile.render
```

## Health check

Set health check path to:

```text
/health
```

## Runtime values

Add these values in the Render service environment page:

```text
TRADING_MODE=paper
CORS_ORIGINS=https://crypto-signal-bot-indol.vercel.app
EVENT_LOG_ENABLED=true
EVENT_LOG_PATH=/tmp/crypto-signal-bot/event_log.db
AUDIT_STORE_PATH=/tmp/crypto-signal-bot/audit.json
EARNINGS_STORE_PATH=/tmp/crypto-signal-bot/earnings.json
BACKEND_API_KEY=replace-with-a-long-private-value
```

## Deploy

After saving settings, run:

```text
Manual Deploy -> Deploy latest commit
```

Then open:

```text
https://your-render-service.onrender.com/health
```

If the health endpoint returns JSON, copy the Render base URL into Vercel as `VITE_BACKEND_URL` and redeploy the frontend.
