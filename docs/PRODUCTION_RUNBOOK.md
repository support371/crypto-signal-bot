# Production Runbook

## 1. Validate repository

Run root lint, tests, architecture typecheck, usage-management verifier, production-contract verifier and build. Run Worker build/provider/safety/migration gates. Do not continue through a red gate.

## 2. Confirm release identity

Required targets:

- frontend `https://crypto-signal-bot-indol.vercel.app`
- Worker `https://crypto-signal-bot-api.analyzer-d94.workers.dev`
- BTCC primary execution
- Bitget secondary execution
- Coinbase public market data

## 3. Confirm safety

Paper/testnet must be true operational posture; mainnet, live trading, withdrawals, provider mutation and real funds must be false.

## 4. Deploy Worker

Use the current Cloudflare account credentials supplied by the environment. Never use the historical hard-coded account ID. Run the guarded release gate and Wrangler deployment, then smoke the migrated Worker.

## 5. Deploy frontend

Deploy the accepted main SHA to Vercel and make the canonical alias serve that exact SHA. Verify release manifest and attestation from the canonical host, not only a generated preview URL.

## 6. Configure identity

Vercel needs browser-safe identity URL/key. Worker needs matching identity URL/key. Canonical demo identity stays disabled.

## 7. Bootstrap administration

Authenticate the first intended release administrator and use the server-protected bootstrap endpoint once. Create a second RELEASE_ADMIN before relying on separation-of-duties administration.

## 8. Acceptance probes

Expected:

- `/healthz` -> 200 JSON
- `/runtime/status` -> paper/testnet locks
- `/v2/infrastructure/status` -> 200
- `/agent/context` -> 200/207 with required dependencies reported
- `/exchange/circuit-breakers` -> BTCC and Bitget present/closed for healthy certification state
- anonymous `/agent/memory/*` -> 401
- anonymous `/d1/query/readonly` -> 401
- `/intent/live` -> 403
- `/live/order` -> 403
- `/withdraw` -> 403

After identity setup, authenticated `/v1/management/me` must return the actor profile/access state; unauthenticated management calls must return 401.

## 9. Rollback

Rollback frontend to the previous accepted Vercel deployment and Worker to the previous accepted Worker version while keeping all paper/testnet locks. Forward-only D1 management tables may remain; rollback code must tolerate them. Never roll back by re-enabling an old Cloudflare account/hostname.
