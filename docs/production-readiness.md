# Production Readiness — Paper Certification + Usage Management

## Canonical production

- Frontend: `https://crypto-signal-bot-indol.vercel.app`
- Dashboard: `https://crypto-signal-bot-indol.vercel.app/dashboard`
- Account: `https://crypto-signal-bot-indol.vercel.app/account`
- Admin: `https://crypto-signal-bot-indol.vercel.app/admin`
- Status: `https://crypto-signal-bot-indol.vercel.app/status`
- Cloudflare Worker: `https://crypto-signal-bot-api.analyzer-d94.workers.dev`
- Release manifest: `https://crypto-signal-bot-indol.vercel.app/release.json`
- Attestation: `https://crypto-signal-bot-indol.vercel.app/api/release-attestation`

The old `crypto-signal-bot-api.gr8r9bfzry.workers.dev` identity belongs to a previous Cloudflare deployment and is not an active release target.

## Safety contract

The release must remain:

```env
TRADING_MODE=paper
EXCHANGE_MODE=paper
NETWORK=testnet
ALLOW_MAINNET=false
LIVE_TRADING_ENABLED=false
WITHDRAWALS_ENABLED=false
```

The public release contract also requires `provider_mutation_enabled=false`, `real_funds_enabled=false`, BTCC primary execution, Bitget secondary execution, and Coinbase public market-data only.

## Production authentication

Canonical production must use a real external identity-provider session. Configure Vercel with browser-safe values only:

```env
VITE_BACKEND_URL=https://crypto-signal-bot-api.analyzer-d94.workers.dev
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<browser-safe-publishable-or-anon-key>
```

Configure the Worker with the same identity-provider URL/key for bearer-session validation:

```env
SUPABASE_URL=<project-url>
SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
```

`BACKEND_API_KEY` is a Worker/server secret used for privileged server bootstrap/helpers. Never expose it in `VITE_*` variables or browser storage.

The canonical frontend runtime rejects synthetic demo identity even if a stale Vercel `VITE_DEMO_MODE=true` setting remains.

## Usage-management acceptance

The Worker management API under `/v1/management` must provide:

- authenticated `/me` profile/access state;
- user lifecycle state (`INVITED`, `PENDING`, `ACTIVE`, `SUSPENDED`, `DISABLED`);
- scoped roles reusing `live_actor_roles`;
- server-authoritative role evaluation;
- first-admin bootstrap protected by server API key plus an authenticated bearer session;
- immutable management audit events;
- aggregated daily usage evidence;
- management request rate limits with HTTP 429 and `Retry-After`;
- session-security events without storing tokens;
- system/safety visibility.

Admin routing must be protected by Worker-derived access, not only hidden navigation.

## Release procedure

1. Run root and Worker validation gates.
2. Confirm the intended SHA is on `main` and CI is green.
3. Confirm no active operational file points at the old Cloudflare Worker/account.
4. Deploy the paper Worker through the controlled Cloudflare release lane.
5. Apply/verify forward-only D1 migrations through usage-management migration 031.
6. Deploy/promote the matching Vercel build to the canonical alias.
7. Run `npm run verify:deployment`.
8. Verify `/release.json`, `/status`, `/api/release-attestation`, `/dashboard`, `/account` and authenticated `/v1/management/me`.
9. Verify anonymous privileged helpers return 401 and disabled live/withdrawal routes return 403.
10. Record release SHA, Worker deployment, Vercel deployment and rollback target.

## Deployment-drift response

If verification fails, do not call the release current. Compare Vercel SHA with `main`, verify Worker host/account, check D1/KV bindings, and repair routing/configuration while keeping all financial mutation locks disabled.
