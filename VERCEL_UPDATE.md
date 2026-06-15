# Vercel Update

Set this environment variable for Production, Preview, and Development unless a different preview backend is intentionally used:

```text
VITE_BACKEND_URL=https://crypto-signal-bot-api.gr8r9bfzry.workers.dev
```

Then trigger a Vercel production redeploy for the `crypto-signal-bot` project.

Do not put real API keys, exchange credentials, or server-only secrets in `VITE_*` variables. Vite exposes these values to the browser bundle.
