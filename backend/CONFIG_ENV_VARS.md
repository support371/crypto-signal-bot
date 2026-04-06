# Backend Environment Variables

This backend is paper-first by default. Use `backend/env/.env.example` as the
authoritative template and override values in your deployment environment.

## Core runtime

| Variable | Default | Notes |
|---|---|---|
| `TRADING_MODE` | `paper` | `paper` or `live` |
| `EXCHANGE` | `binance` | Authenticated live execution venue: `binance`, `bitget`, or `btcc` |
| `PAPER_USE_LIVE_MARKET_DATA` | `false` | `true` keeps paper execution but switches market data to a live public feed |
| `MARKET_DATA_PUBLIC_EXCHANGE` | `EXCHANGE` | Public feed used in hybrid paper mode |
| `NETWORK` | `testnet` | `testnet` for certification/demo, `mainnet` for guarded production use |
| `BACKEND_API_KEY` | _(empty)_ | Restricts POST endpoints when set |
| `CORS_ORIGINS` | localhost origins | Comma-separated frontend origins |
| `RATE_LIMIT_RPM` | `120` | GET requests per minute per IP |

## Guardian and persistence

| Variable | Default | Notes |
|---|---|---|
| `GUARDIAN_MAX_API_ERRORS` | `10` | Kill-switch threshold |
| `GUARDIAN_MAX_FAILED_ORDERS` | `5` | Kill-switch threshold |
| `GUARDIAN_MAX_DRAWDOWN_PCT` | `0.05` | 5% drawdown threshold |
| `AUDIT_STORE_PATH` | `backend/data/audit.json` | Audit-trail file |
| `EARNINGS_STORE_PATH` | `backend/data/earnings.json` | Earnings ledger file |

## Live credentials

Set only the credentials that match the selected `EXCHANGE`.

| Exchange | Variables |
|---|---|
| Binance | `BINANCE_API_KEY`, `BINANCE_API_SECRET` |
| Bitget | `BITGET_API_KEY`, `BITGET_API_SECRET`, `BITGET_API_PASSPHRASE` |
| BTCC | `BTCC_API_KEY`, `BTCC_API_SECRET` |

`ALLOW_MAINNET=true` is additionally required before any mainnet execution path
is allowed to stay live.

## Mode examples

### Synthetic paper

```bash
export TRADING_MODE=paper
export EXCHANGE=binance
export PAPER_USE_LIVE_MARKET_DATA=false
```

### Hybrid live-paper

```bash
export TRADING_MODE=paper
export EXCHANGE=binance
export MARKET_DATA_PUBLIC_EXCHANGE=bitget
export PAPER_USE_LIVE_MARKET_DATA=true
```

### Live certification

```bash
export TRADING_MODE=live
export EXCHANGE=binance
export NETWORK=testnet
export BINANCE_API_KEY=...
export BINANCE_API_SECRET=...
```

If live mode falls back to paper, check missing credentials, missing `ccxt`, or
an unsupported exchange sandbox path before proceeding.
