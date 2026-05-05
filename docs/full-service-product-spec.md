# Full-Service Product Specification

This specification defines the working direction for the public site, provider services, command centre, trading modes, risk controls, audit trail, and reconciliation roadmap.

## Public platform

The public platform should provide:

- A landing page for product positioning and onboarding.
- Market, education, resource, pricing, risk, contact, and waitlist pages.
- A public integration status page backed by `/api/v1/integrations/status`.
- Clear separation from the authenticated command centre.

## Provider registry

The provider registry should track:

- Provider name and category.
- Supported markets.
- Current status.
- Last successful update timestamp.
- Future health-check and rate-limit metadata.

The first implementation is JSON-backed and seeded with Coingecko, Yahoo Finance, and Forex.com.

## Waitlist

The first waitlist implementation stores validated email submissions in JSON and rejects duplicates. Before production scale, this should move to a database, CRM, or marketing automation backend.

## Command centre

The private command centre should preserve the current dashboard while adding compatibility routes for legacy clients:

- `GET /api/account/summary`
- `GET /api/signals/recent`
- `GET /api/positions`
- `GET /api/guardian/status`
- `GET /api/equity/history`

These endpoints should wrap existing backend services rather than duplicate trading logic.

## Trading modes

The roadmap remains:

1. Paper mode as the default.
2. Real-time paper mode using public market feeds.
3. Testnet/demo mode for exchange testing.
4. Gated live mode with explicit approval and active controls.

## Risk and guardian controls

Risk controls should remain configurable, explainable, and auditable. Guardian events, kill-switch changes, and blocked intents should be visible in the dashboard and written to the event/audit system.

## Audit and reconciliation roadmap

The JSON audit baseline should evolve into a durable event store with:

- Structured event types.
- Query endpoints.
- Pagination and filtering.
- Reconciliation reports.
- Critical discrepancy escalation.

## Current branch scope

This branch implements the first public integration and waitlist slice. It does not attempt to replace the trading backend, exchange adapter, dashboard, or deployment architecture.
