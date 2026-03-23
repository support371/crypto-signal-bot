# Replit to GitHub Handoff Guide

## Current state

- Replit currently has the frontend control-center prototype.
- The next target is a paper-mode full-stack build.
- The backend target is six modules:
  1. listener
  2. scorer
  3. guardian
  4. execution router
  5. audit store
  6. health API

## Target backend behavior

The backend should:
- generate simulated market and listing events
- score opportunities as buy, watch, or ignore
- apply hard risk rules
- create paper orders and positions
- persist settings, watchlist, positions, orders, audit, and state
- expose health and status endpoints

## Expected API surface

- `GET /health`
- `GET /watchlist`
- `GET /positions`
- `GET /orders`
- `GET /audit`
- `GET /settings`
- `GET /state`
- `POST /settings`
- `POST /cycle`

## Replit agent instruction

Paste this into the Replit agent:

> Complete this app into a paper-mode full-stack crypto automation control center. Keep the current UI. Implement modules 1 to 6: listener, scorer, guardian, execution router, audit store, and health API. Generate simulated market and listing events, score opportunities, apply hard risk rules, create paper orders and positions, persist audit and state data, and wire all pages to live backend APIs. Keep Bitget and BTCC as placeholder settings only. Default to paper mode. Make the app runnable end to end with automatic recurring cycles and a manual cycle trigger.

## GitHub sync objective

Once Replit finishes the full-stack implementation, connect or push the Replit project back into this repository so the repo becomes the canonical source of truth.

Recommended commit phases:
1. frontend shell sync
2. backend module sync
3. API wiring
4. persistence and settings
5. health and audit validation
