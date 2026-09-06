# Access Control

The application reuses the Worker authorization vocabulary already present in `live_actor_roles`.

## Roles

- `VIEWER`
- `TRADER`
- `RISK_OPERATOR`
- `RISK_ADMIN`
- `WITHDRAWAL_REQUESTER`
- `WITHDRAWAL_APPROVER`
- `AUDITOR`
- `RELEASE_ADMIN`

## Scopes

Role grants can be `GLOBAL`, `EXCHANGE` or `ACCOUNT` scoped. Expired and revoked grants do not authorize access. Administrative authority is recognized only from an active `GLOBAL:global` management grant; an account- or exchange-scoped role cannot become global administration authority.

## Management permissions

- RISK_ADMIN, AUDITOR and RELEASE_ADMIN can read the administration surface.
- AUDITOR, RISK_ADMIN and RELEASE_ADMIN can inspect immutable management audit evidence.
- RELEASE_ADMIN is the only management role allowed to change user lifecycle or grant/revoke management roles.
- RISK_ADMIN and RELEASE_ADMIN can inspect system-management state.

## Separation of duties

A RELEASE_ADMIN cannot self-grant roles and cannot perform administrative lifecycle changes on their own account. Self-revocation of RELEASE_ADMIN is blocked so another release administrator must perform the change.

## Authentication authority

The browser sends the external bearer session; it does not send an authoritative role claim. The Worker validates the session with the identity provider and loads roles from D1 on each authorization refresh.

The server bootstrap path requires the server operator key, a valid external bearer session, and AAL2 step-up. User lifecycle and role-grant mutations also require AAL2. The Worker reads the assurance level only after the identity provider has validated the bearer session.

## Permanent capability locks

No role can override `paper`, `testnet`, mainnet disabled, live trading disabled, withdrawals disabled, provider mutation disabled or real funds disabled.
