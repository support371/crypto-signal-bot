# Account Security

## Identity

Passwords are never stored by Crypto Signal Bot. Sign-up, login, recovery and password update use the configured Supabase-compatible identity provider.

## Canonical production

The canonical `crypto-signal-bot-indol.vercel.app` domain never injects the synthetic demo identity. Production requires a valid external session.

## Password recovery

`/reset-password` can request a provider recovery email and can update a password after a valid recovery/authenticated session is established.

## Session evidence

The application records non-sensitive session-security events such as `SESSION_RESTORED`, `PASSWORD_UPDATED` and `SECURITY_REVIEWED`. Access/refresh tokens are not written to D1 audit tables.

## Authenticator step-up

`/account` supports Supabase TOTP enrollment and verification. A verified AAL2 session is required for bootstrap, user lifecycle changes, and role grant/revocation. The TOTP secret is displayed only during provider enrollment and is not persisted by Crypto Signal Bot.

Email changes are requested through the identity provider and remain subject to its confirmation policy.

## Account status

Suspended or disabled profiles fail closed at the protected routing and Worker management layers.

## Secrets

Never store provider service-role keys, exchange secrets, Cloudflare credentials, backend operator keys, access tokens or refresh tokens in browser-local configuration or `VITE_*` variables.
