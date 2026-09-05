# Admin Operations

Authenticated administrators use `/admin` and its subordinate routes:

- `/admin/users`
- `/admin/access`
- `/admin/sessions`
- `/admin/usage`
- `/admin/audit`
- `/admin/system`

The frontend gate is convenience and user experience; the Worker remains authoritative.

## First release administrator

After the production identity provider is configured, authenticate the intended first administrator. The one-time bootstrap request to `/v1/management/bootstrap` must include:

1. the authenticated bearer session; and
2. the Worker/server `BACKEND_API_KEY`.

The route writes an immutable audit event and grants GLOBAL `RELEASE_ADMIN`. Never put `BACKEND_API_KEY` in Vercel browser variables or local storage.

## User lifecycle

RELEASE_ADMIN can activate, suspend or disable another user. Suspension requires a reason and takes effect on the next protected authorization refresh.

## Access grants

RELEASE_ADMIN can grant/revoke the existing scoped role vocabulary. Current UI defaults to GLOBAL grants; Worker data supports GLOBAL/EXCHANGE/ACCOUNT scope semantics.

## Audit

Management mutations write immutable hash-referenced events. The management audit table has database triggers preventing update/delete.

## Incident posture

When identity, D1 or authorization evidence is unavailable, management access fails closed. Do not bypass management authorization to restore availability; repair the dependency.
