# Certification Access Diagnostics

## Purpose

This document describes the read-only diagnostics used to separate frontend availability, backend health, and browser-network reachability. It does not authorize an operator, proxy account data, connect provider credentials, or enable operational capabilities.

## Same-origin status mirror

`GET /api/certification/status` returns minimized deployment metadata and permanent capability locks. The response is not cached and all operational capabilities remain `false`.

## Server-side Worker health diagnostic

`GET /api/certification/backend-health` performs one bounded server-side request to the configured Cloudflare Worker `/health` route.

The diagnostic contract is fixed:

- HTTPS `*.workers.dev` targets only.
- Server-controlled configuration only.
- `/health` path only.
- One `GET` request.
- Four-second upstream timeout.
- No redirects.
- No credentials or authorization headers.
- No upstream response-body read.
- No retries.
- No account, portfolio, order, or signal data.

## Interpreting results

- **Browser succeeds, Vercel succeeds:** the connected dashboard may load.
- **Browser fails, Vercel succeeds:** the Worker is healthy; the device, carrier, DNS resolver, VPN, content filter, or browser network path cannot reach `workers.dev` directly. The dashboard remains closed because its subsequent browser requests would also fail.
- **Browser fails, Vercel fails:** investigate the Worker deployment or configured hostname.
- **Diagnostic unavailable:** retain the static Certification Overview and do not infer backend health.

## Current measured result

On the preview candidate at commit `be29eab89335ddaa20a78023624b75c86abb9434`, Vercel reached `crypto-signal-bot-api.gr8r9bfzry.workers.dev/health` with HTTP 200. This establishes that the observed mobile access failure is a browser/network-path issue rather than a Worker outage.

## Remaining architecture work

A same-origin relay for protected dashboard resources must not be activated until an approved server-side identity provider, verified sessions, role resolution, and account scope are connected. The existing operator gateway foundation remains disconnected and fail-closed.
