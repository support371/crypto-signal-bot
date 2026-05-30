# Production Fix — 2026-05-30

## Summary
294/294 tests passing. Deployed to GitHub → Render auto-deploy triggered.

## Issues Fixed

### 1. exchange_retry.py — Missing `with_retry` + `RetryableAdapter` (8 test failures)
**Root cause:** Tests expected a synchronous `with_retry(fn, max_retries, base_delay)` function
and a `RetryableAdapter` class to be importable from `backend.services.exchange_retry`.
The module existed but only had async circuit breaker wiring, not these exports.

**Fix:** Added `with_retry()` (sync exponential backoff, retries only transient errors:
`ConnectionError, TimeoutError, OSError`) and `RetryableAdapter` (wraps any adapter,
proxies all method calls through `with_retry`). Non-retriable exceptions (auth, funds, logic)
propagate immediately without retry.

### 2. Guardian shows `connected: false` + `source: https://api.btcc.com`
**Root cause:** `_get_adapters()` in `services/market_data/service.py` always used BTCC
as the primary adapter (via `get_adapter(cfg)` which selects BTCC first in paper mode).
BTCC's public market data API requires setup — `exchange_status()` pings BTCC and gets
connection refused, so guardian health check shows offline.

**Fix:** Added `get_market_data_adapter(cfg)` factory to `adapters/exchanges/__init__.py`.
In paper mode, it returns `BinanceAdapter(paper=True, testnet=False)` — Binance's public
REST API (`/api/v3/ping`, `/api/v3/ticker/24hr`) works without credentials on Render's
US/EU servers. `_get_adapters()` now uses `get_market_data_adapter()` as primary.

### 3. Price endpoint returning synthetic data
**Root cause:** `PAPER_USE_LIVE_MARKET_DATA=false` in render.yaml meant the
`BinancePublicMarketDataService` never started, so `/price` always returned synthetic
random-walk prices.

**Fix:** Changed `render.yaml` to `PAPER_USE_LIVE_MARKET_DATA=true`. On startup,
`BinancePublicMarketDataService` now starts and polls `api.binance.com/api/v3/ticker/24hr`
every 15s for all 10 symbols. The `/price` endpoint returns real prices once the
first poll completes (~15s after boot).

### 4. Rate limiter not respecting real client IPs behind Render's proxy
**Fix:** `rate_limit.py` now reads `X-Forwarded-For` header first. Added
`ProxyHeadersMiddleware` to app.py so `request.client.host` is also correct.

### 5. Binance/Bitget adapters — no circuit breaker or retry
**Fix:** Added `CircuitBreaker` (trips at 5 failures, recovers after 60s) and
`@with_retry(max_attempts=3, base_delay=0.5)` decorator to `_get_public()` in both
adapters.

## After Render Deploys
1. `/exchange/status` → `connected: true`, `source: https://api.binance.com`
2. `/guardian/status` → `market_data.connected: true`
3. `/price?symbol=BTCUSDT` → real Binance price, `source: binance-public`
4. WebSocket ticker → live prices after first poll cycle
5. `/exchange/circuit-breakers` → new endpoint for CB observability

## Vercel Frontend
No changes needed. Frontend already points to Render backend correctly.
