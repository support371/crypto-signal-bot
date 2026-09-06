# Vercel Production Update

Canonical project: `crypto-signal-bot`

Production backend:

```text
https://crypto-signal-bot-api.analyzer-d94.workers.dev
```

Set `VITE_BACKEND_URL` to that Worker for production. Canonical production also requires the browser-safe external identity provider URL and publishable/anon key. Keep `VITE_DEMO_MODE=false`.

Do not use the legacy `gr8r9bfzry` Worker hostname. After deployment verify the canonical alias, `/release.json`, `/status` and `/api/release-attestation` all resolve from the same accepted main SHA.
