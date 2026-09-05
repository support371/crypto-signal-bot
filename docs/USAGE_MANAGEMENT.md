# Usage Management

The usage-management plane turns the certification application into a manageable multi-user product without enabling live financial execution.

## Data model

`app_user_profiles` stores application lifecycle metadata only. Passwords and provider credentials remain external.

`app_usage_daily` stores aggregated counts by day, actor and category. It does not store sensitive request bodies.

`management_rate_windows` enforces bounded per-actor management traffic.

`session_security_events` records security-significant account events while token/session issuance remains authoritative at the external identity provider.

## Lifecycle

Supported states: `INVITED`, `PENDING`, `ACTIVE`, `SUSPENDED`, `DISABLED`.

Only ACTIVE users can continue through protected management gates. RELEASE_ADMIN lifecycle changes to their own account are blocked to preserve separation of duties.

## Usage categories

The Worker accepts only an allowlisted set of non-sensitive feature categories such as dashboard view, portfolio view, backtest run, signal query, paper intent, infrastructure view, operator-readiness view, account view and admin view.

## Rate policy

Default management policy:

- authenticated reads: 120 requests/minute per actor;
- authenticated writes: 30 requests/minute per actor;
- bootstrap: 5 requests/minute per actor.

Exceeded limits return HTTP 429 with a stable `RATE_LIMITED` code, request ID and `Retry-After` header.

## Safety

Usage administration never changes paper/testnet/mainnet/withdrawal/provider-mutation locks. Role grants control application authority only.
