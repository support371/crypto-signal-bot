# Switchere Card Security Gateway

## Implemented flow

1. An authenticated client opens `/card-funding`.
2. The Worker verifies the Supabase access token or an operator API key.
3. The preflight rejects any request containing PAN, CVC/CVV, PIN, or magnetic-stripe fields.
4. The Worker checks client approval, cardholder-name match, card-use permission, amount limits, country card eligibility, currency routing, and card-method availability.
5. A one-time partner order ID and one-time status token are created and stored in D1 as hashes.
6. The browser loads the hosted Switchere widget. Card details are entered directly into Switchere, not the GEM Worker or frontend state.
7. Switchere performs card verification, issuing-bank authorisation, and provider-managed 3-D Secure.
8. Signed callbacks update bank-authorisation, bank-second-factor, card-verification, status, substatus, masked-card, and provider-error state.
9. The frontend polls the token-bound status endpoint and displays each check.

## Worker routes

- `GET /funding/switchere/health`
- `POST /funding/switchere/preflight`
- `GET /funding/switchere/status/:partnerOrderId?token=...`
- `POST /funding/switchere/callback`

## Required Cloudflare configuration

Apply the D1 migration to an isolated sandbox database before deploying this branch:

```bash
cd worker
npx wrangler d1 execute crypto-signal-bot-db \
  --config ../wrangler.toml \
  --local \
  --file migrations/031_switchere_funding_guard.sql
```

Configure the Switchere sandbox partner key:

```bash
cd worker
npx wrangler secret put SWITCHERE_PARTNER_KEY --config ../wrangler.toml
```

Configure the Switchere callback secret supplied in the partner account:

```bash
cd worker
npx wrangler secret put SWITCHERE_CALLBACK_SECRET --config ../wrangler.toml
```

Configure the Supabase project URL and publishable/anonymous key used to verify the authenticated client session:

```bash
cd worker
npx wrangler secret put SUPABASE_URL --config ../wrangler.toml
npx wrangler secret put SUPABASE_ANON_KEY --config ../wrangler.toml
```

Register this callback URL in the Switchere sandbox partner settings:

```text
https://<sandbox-worker-host>/funding/switchere/callback
```

## Default deployment state

```text
SWITCHERE_MODE=sandbox
SWITCHERE_LIVE_ENABLED=false
```

The production Switchere SDK cannot initialise while production funding is disabled. No production activation, card charge, crypto payout, or funds movement is performed by this branch.
