/**
 * crypto-signal-bot — Cloudflare Worker (hardened v2)
 *
 * Architecture:
 *  - Single entry point — no duplicate logic across compat/renderParity
 *  - All compat + renderParity routes are re-exported from this file
 *  - API key auth on every write endpoint
 *  - CORS from env CORS_ALLOWED_ORIGINS
 *  - Dual price source: Coinbase primary → Binance public fallback → D1 cache → static fallback
 *  - Circuit breaker per external source (resets after 5 min)
 *  - Rate limiting via D1 (per-IP, per-minute)
 *  - Cron scheduled() handler for all 4 triggers
 *  - Guardian state always bootstrapped (never null)
 *  - Paper-safety hardcoded — live trading and withdrawals are permanently blocked
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { agentRouter } from './routes/agent'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  DB: D1Database
  STORAGE: R2Bucket
  TRADING_MODE: string
  EXCHANGE_MODE: string
  NETWORK: string
  ALLOW_MAINNET: string
  MARKET_DATA_PUBLIC_EXCHANGE: string
  PAPER_STARTING_BALANCE_USDT: string
  GUARDIAN_MAX_DRAWDOWN_PCT: string
  GUARDIAN_MAX_API_ERRORS: string
  GUARDIAN_MAX_FAILED_ORDERS: string
  RATE_LIMIT_RPM: string
  CORS_ALLOWED_ORIGINS: string
  BACKEND_API_KEY?: string
}

type PositionRow = {
  id: number; symbol: string; side: string; quantity: number
  entry_price: number; current_price: number | null; pnl: number | null
  status: string; created_at: string
}
type OrderRow = {
  id: number; symbol: string; side: string; quantity: number
  price: number; status: string; mode: string; created_at: string
}
type SignalRow = {
  id?: number; symbol: string; timeframe?: string; side: string
  confidence: number; entry_price?: number | null; stop_loss?: number | null
  take_profit?: number | null; strategy?: string | null; created_at?: string
}
type GuardianRow = {
  id: number; triggered: number | boolean; reason: string | null
  error_count: number; drawdown_pct: number; updated_at: string
}
type CircuitBreakerRow = {
  source: string; open: number; fail_count: number; last_fail_at: string | null
}
type OrderInput = {
  symbol?: string; side?: string
  quantity?: number | string; qty?: number | string
  amount?: number | string; notional_usdt?: number | string
  price?: number | string; idempotency_key?: string
}

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAPER = 'paper'
const COIN_META: Record<string, { id: string; name: string }> = {
  BTC:  { id: 'bitcoin',       name: 'Bitcoin'   },
  ETH:  { id: 'ethereum',      name: 'Ethereum'  },
  SOL:  { id: 'solana',        name: 'Solana'    },
  BNB:  { id: 'binancecoin',   name: 'BNB'       },
  ADA:  { id: 'cardano',       name: 'Cardano'   },
  XRP:  { id: 'ripple',        name: 'XRP'       },
  DOT:  { id: 'polkadot',      name: 'Polkadot'  },
  AVAX: { id: 'avalanche-2',   name: 'Avalanche' },
  DOGE: { id: 'dogecoin',      name: 'Dogecoin'  },
  LINK: { id: 'chainlink',     name: 'Chainlink' },
}
const FALLBACK_PRICES: Record<string, number> = {
  BTC: 105000, ETH: 3800, SOL: 180, BNB: 700,
  ADA: 0.45, XRP: 0.52, DOT: 8.5, AVAX: 35, DOGE: 0.18, LINK: 18,
}
const CIRCUIT_OPEN_MS  = 5 * 60 * 1000   // 5 min reset window
const CIRCUIT_FAIL_THRESHOLD = 3          // open after 3 consecutive failures

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

const ts  = () => Date.now()
const day = () => new Date().toISOString().split('T')[0]

const n = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

const bool = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true'

const sym = (value?: string | null): string =>
  (value || 'BTC').toUpperCase().trim()
    .replace(/[-/](USDT|USD)$/i, '')
    .replace(/(USDT|USD)$/i, '')

/** Paper-safe runtime flags — NEVER expose live=true */
const safeRuntime = (env: Env) => ({
  mode:                  PAPER,
  trading_mode:          PAPER,
  exchange_mode:         PAPER,
  network:               'testnet',
  allow_mainnet:         false,
  live_trading_enabled:  false,
  withdrawals_enabled:   false,
})

// ────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────────

async function audit(env: Env, event: string, detail: unknown): Promise<void> {
  const payload = typeof detail === 'string' ? detail : JSON.stringify(detail)
  await env.DB.prepare('INSERT INTO audit_trail (event, detail) VALUES (?, ?)')
    .bind(event, payload).run().catch(() => undefined)
}

// ───────────────────────────────────────────────────────────────────────────
// Circuit breaker (D1-backed)
// ────────────────────────────────────────────────────────────────────────────

async function cbIsOpen(env: Env, source: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT open, fail_count, last_fail_at FROM circuit_breaker_state WHERE source = ?'
  ).bind(source).first<CircuitBreakerRow>().catch(() => null)

  if (!row || !bool(row.open)) return false

  // Auto-reset after window
  const lastFail = row.last_fail_at ? new Date(row.last_fail_at).getTime() : 0
  if (ts() - lastFail > CIRCUIT_OPEN_MS) {
    await env.DB.prepare(
      "UPDATE circuit_breaker_state SET open = 0, fail_count = 0 WHERE source = ?"
    ).bind(source).run().catch(() => undefined)
    return false
  }
  return true
}

async function cbRecordSuccess(env: Env, source: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO circuit_breaker_state (source, open, fail_count, last_fail_at)
     VALUES (?, 0, 0, NULL)
     ON CONFLICT(source) DO UPDATE SET open = 0, fail_count = 0`
  ).bind(source).run().catch(() => undefined)
}

async function cbRecordFailure(env: Env, source: string): Promise<void> {
  // Upsert fail count; open circuit at threshold
  await env.DB.prepare(
    `INSERT INTO circuit_breaker_state (source, open, fail_count, last_fail_at)
     VALUES (?, 0, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(source) DO UPDATE SET
       fail_count = fail_count + 1,
       last_fail_at = CURRENT_TIMESTAMP,
       open = CASE WHEN fail_count + 1 >= ? THEN 1 ELSE open END`
  ).bind(source, CIRCUIT_FAIL_THRESHOLD).run().catch(() => undefined)
}

// ─────────────────────────────────────────────────────────────────────────────
// Price resolution (Coinbase → Binance → D1 cache → static)
// ────────────────────────────────────────────────────────────────────────────

async function fetchCoinbase(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const data = await res.json() as { data?: { amount?: string } }
    const price = n(data?.data?.amount, NaN)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

async function fetchBinance(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { price?: string }
    const price = n(data?.price, NaN)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

type PriceResult = { symbol: string; price: number; source: string; stale: boolean; ts: number }

async function resolvePrice(env: Env, rawSymbol?: string | null, explicitPrice?: unknown): Promise<PriceResult> {
  const symbol = sym(rawSymbol)

  // Explicit price from request
  const provided = n(explicitPrice, NaN)
  if (Number.isFinite(provided) && provided > 0) {
    return { symbol, price: provided, source: 'request', stale: false, ts: ts() }
  }

  // Coinbase (primary)
  if (!await cbIsOpen(env, 'coinbase')) {
    const price = await fetchCoinbase(symbol)
    if (price !== null) {
      await cbRecordSuccess(env, 'coinbase')
      await env.DB.prepare(
        'INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)'
      ).bind(symbol, price, 'coinbase').run().catch(() => undefined)
      return { symbol, price, source: 'coinbase', stale: false, ts: ts() }
    }
    await cbRecordFailure(env, 'coinbase')
  }

  // Binance public (fallback)
  if (!await cbIsOpen(env, 'binance')) {
    const price = await fetchBinance(symbol)
    if (price !== null) {
      await cbRecordSuccess(env, 'binance')
      await env.DB.prepare(
        'INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)'
      ).bind(symbol, price, 'binance').run().catch(() => undefined)
      return { symbol, price, source: 'binance', stale: false, ts: ts() }
    }
    await cbRecordFailure(env, 'binance')
  }

  // D1 cache
  const cached = await env.DB.prepare(
    'SELECT price, source FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(symbol).first<{ price: number; source: string }>().catch(() => null)
  if (cached?.price) {
    return { symbol, price: cached.price, source: `cache:${cached.source}`, stale: true, ts: ts() }
  }

  // Static fallback
  return { symbol, price: FALLBACK_PRICES[symbol] ?? 1, source: 'fallback', stale: true, ts: ts() }
}

// ────────────────────────────────────────────────────────────────────────────
// Guardian helpers
// ────────────────────────────────────────────────────────────────────────────

async function ensureGuardian(env: Env): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO guardian_state (id, triggered, reason, error_count, drawdown_pct) VALUES (1, 0, NULL, 0, 0.0)'
  ).run().catch(() => undefined)
}

async function getGuardian(env: Env): Promise<GuardianRow & Record<string, unknown>> {
  await ensureGuardian(env)
  const row = await env.DB.prepare('SELECT * FROM guardian_state WHERE id = 1')
    .first<GuardianRow>().catch(() => null)
  return {
    id: 1,
    triggered: bool(row?.triggered ?? 0),
    reason: row?.reason ?? null,
    error_count: n(row?.error_count),
    drawdown_pct: n(row?.drawdown_pct),
    updated_at: row?.updated_at ?? new Date().toISOString(),
    max_drawdown_pct: n(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
    max_api_errors: n(env.GUARDIAN_MAX_API_ERRORS, 10),
    max_failed_orders: n(env.GUARDIAN_MAX_FAILED_ORDERS, 5),
    ...safeRuntime(env),
    ts: ts(),
  }
}

async function isHalted(env: Env): Promise<boolean> {
  await ensureGuardian(env)
  const row = await env.DB.prepare(
    'SELECT triggered FROM guardian_state WHERE id = 1'
  ).first<{ triggered: number }>().catch(() => null)
  return bool(row?.triggered ?? 0)
}

// ────────────────────────────────────────────────────────────────────────────
// Balance & portfolio helpers
// ────────────────────────────────────────────────────────────────────────────

async function getBalance(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT id, quantity FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1"
  ).first<{ id: number; quantity: number }>().catch(() => null)
  if (row?.quantity !== undefined) return n(row.quantity, 10000)
  const starting = n(env.PAPER_STARTING_BALANCE_USDT, 10000)
  await env.DB.prepare(
    "INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES ('USDT', 'balance', ?, 1.0, 1.0, 0, 'balance')"
  ).bind(starting).run().catch(() => undefined)
  return starting
}

async function setBalance(env: Env, value: number): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT id FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1"
  ).first<{ id: number }>().catch(() => null)
  if (row?.id) {
    await env.DB.prepare('UPDATE portfolio SET quantity = ? WHERE id = ?').bind(value, row.id).run()
  } else {
    await env.DB.prepare(
      "INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES ('USDT', 'balance', ?, 1.0, 1.0, 0, 'balance')"
    ).bind(value).run()
  }
}

async function openPositions(env: Env, filterSymbol?: string): Promise<PositionRow[]> {
  const normalized = filterSymbol ? sym(filterSymbol) : null
  const query = normalized
    ? "SELECT * FROM portfolio WHERE status = 'open' AND symbol = ? ORDER BY created_at ASC"
    : "SELECT * FROM portfolio WHERE status = 'open' AND symbol != 'USDT' ORDER BY created_at ASC"
  const stmt = normalized ? env.DB.prepare(query).bind(normalized) : env.DB.prepare(query)
  const rows = await stmt.all<PositionRow>().catch(() => ({ results: [] as PositionRow[] }))
  return rows.results ?? []
}

async function recordPnl(env: Env, pnl: number): Promise<void> {
  const total = await env.DB.prepare('SELECT SUM(pnl) as total FROM earnings')
    .first<{ total: number }>().catch(() => null)
  await env.DB.prepare('INSERT INTO earnings (date, pnl, cumulative_pnl) VALUES (?, ?, ?)')
    .bind(day(), pnl, n(total?.total) + pnl).run()
}

async function getPortfolio(env: Env) {
  const cash = await getBalance(env)
  const positions = await openPositions(env)
  const enriched = await Promise.all(positions.map(async (pos) => {
    const px = await resolvePrice(env, pos.symbol)
    const qty = n(pos.quantity)
    const pnl = (px.price - n(pos.entry_price)) * qty
    return {
      ...pos, symbol: sym(pos.symbol),
      current_price: px.price,
      market_value_usdt: qty * px.price,
      unrealized_pnl: pnl,
      pnl,
    }
  }))
  const earned = await env.DB.prepare('SELECT SUM(pnl) as realized_pnl FROM earnings')
    .first<{ realized_pnl: number }>().catch(() => null)
  const posValue   = enriched.reduce((s, p) => s + n(p.market_value_usdt), 0)
  const unrealized = enriched.reduce((s, p) => s + n(p.unrealized_pnl), 0)
  const realized   = n(earned?.realized_pnl)
  return {
    balance_usdt:         cash,
    cash_usdt:            cash,
    equity_usdt:          cash + posValue,
    positions_value_usdt: posValue,
    realized_pnl:         realized,
    unrealized_pnl:       unrealized,
    total_pnl:            realized + unrealized,
    open_positions:       enriched,
    positions:            enriched,
    position_count:       enriched.length,
    ...safeRuntime(env),
    ts: ts(),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Paper order engine
// ────────────────────────────────────────────────────────────────────────

async function placePaperOrder(env: Env, input: OrderInput) {
  // Idempotency check
  if (input.idempotency_key) {
    const existing = await env.DB.prepare(
      "SELECT id FROM orders WHERE mode = 'paper' AND status = 'FILLED' AND detail LIKE ? LIMIT 1"
    ).bind(`%${input.idempotency_key}%`).first<{ id: number }>().catch(() => null)
    if (existing) return { status: 200 as const, body: { status: 'FILLED', idempotent: true, ...safeRuntime(env) } }
  }

  if (await isHalted(env)) {
    return { status: 403 as const, body: { error: 'Guardian kill switch active — trading paused', ...safeRuntime(env) } }
  }

  const px     = await resolvePrice(env, input.symbol, input.price)
  const symbol = px.symbol
  const side   = String(input.side ?? 'BUY').toUpperCase()

  if (side !== 'BUY' && side !== 'SELL') {
    return { status: 400 as const, body: { error: 'Invalid side — must be BUY or SELL', ...safeRuntime(env) } }
  }

  let qty = n(input.quantity ?? input.qty)
  const notional = n(input.notional_usdt ?? input.amount)
  if (qty <= 0 && notional > 0 && px.price > 0) qty = notional / px.price
  if (qty <= 0 || px.price <= 0) {
    return { status: 400 as const, body: { error: 'Missing valid quantity or price', ...safeRuntime(env) } }
  }

  const cash  = await getBalance(env)
  const value = qty * px.price
  let realized = 0

  if (side === 'BUY') {
    if (cash < value) {
      return { status: 400 as const, body: { error: 'Insufficient paper balance', balance_usdt: cash, required_usdt: value, ...safeRuntime(env) } }
    }
    await setBalance(env, cash - value)
    await env.DB.prepare(
      'INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).bind(symbol, 'long', qty, px.price, px.price, 'open').run()
  } else {
    const lots = (await openPositions(env, symbol))
    const available = lots.reduce((s, p) => s + n(p.quantity), 0)
    if (available < qty - 0.00000001) {
      return { status: 400 as const, body: { error: 'Insufficient paper position', available_quantity: available, requested_quantity: qty, ...safeRuntime(env) } }
    }
    let remaining = qty
    for (const lot of lots) {
      if (remaining <= 0) break
      const lotQty  = n(lot.quantity)
      const closed  = Math.min(lotQty, remaining)
      const lotPnl  = (px.price - n(lot.entry_price)) * closed
      realized += lotPnl
      const newQty  = lotQty - closed
      if (newQty <= 0.00000001) {
        await env.DB.prepare(
          'UPDATE portfolio SET quantity = 0, current_price = ?, pnl = ?, status = ? WHERE id = ?'
        ).bind(px.price, (px.price - n(lot.entry_price)) * lotQty, 'closed', lot.id).run()
      } else {
        await env.DB.prepare(
          'UPDATE portfolio SET quantity = ?, current_price = ?, pnl = ? WHERE id = ?'
        ).bind(newQty, px.price, (px.price - n(lot.entry_price)) * newQty, lot.id).run()
      }
      remaining -= closed
    }
    await setBalance(env, cash + value)
    await recordPnl(env, realized)
  }

  await env.DB.prepare(
    'INSERT INTO orders (symbol, side, quantity, price, status, mode) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(symbol, side, qty, px.price, 'FILLED', PAPER).run()

  const result = {
    status: 'FILLED', symbol, side, quantity: qty,
    price: px.price, fill_price: px.price,
    notional_usdt: value, realized_pnl: realized,
    price_source: px.source, price_stale: px.stale,
    ...safeRuntime(env), ts: ts(),
  }
  await audit(env, 'paper_order', result)
  return { status: 200 as const, body: result }
}

// ──────────────────────────────────────────────────────────────────────────
// Auth middleware
// ────────────────────────────────────────────────────────────────────────────

function requireApiKey(env: Env, req: Request): boolean {
  if (!env.BACKEND_API_KEY) return true   // key not configured → open (dev mode)
  const fromHeader = req.headers.get('X-API-Key') ?? req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  return fromHeader === env.BACKEND_API_KEY
}

// ────────────────────────────────────────────────────────────────────────────
// Rate limiter (D1, per-IP per-minute bucket)
// ─────────────────────────────────────────────────────────────────────────────────

async function checkRateLimit(env: Env, req: Request): Promise<boolean> {
  const rpm = n(env.RATE_LIMIT_RPM, 120)
  const ip  = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const bucket = `${ip}:${Math.floor(Date.now() / 60000)}`
  try {
    const row = await env.DB.prepare(
      'SELECT count FROM rate_limit_counters WHERE bucket = ?'
    ).bind(bucket).first<{ count: number }>()
    const count = n(row?.count) + 1
    if (count > rpm) return false
    if (row) {
      await env.DB.prepare('UPDATE rate_limit_counters SET count = ? WHERE bucket = ?').bind(count, bucket).run()
    } else {
      await env.DB.prepare('INSERT INTO rate_limit_counters (bucket, count) VALUES (?, ?)').bind(bucket, 1).run()
    }
  } catch {
    // If D1 fails, allow the request through
  }
  return true
}

// ────────────────────────────────────────────────────────────────────────────
// Scheduled cron jobs
// ────────────────────────────────────────────────────────────────────────────

async function cronEvery5Min(env: Env): Promise<void> {
  // Refresh prices for all tracked symbols
  const symbols = Object.keys(COIN_META)
  for (const s of symbols) {
    await resolvePrice(env, s)
  }
  // Purge stale rate-limit buckets older than 2 minutes
  await env.DB.prepare(
    "DELETE FROM rate_limit_counters WHERE CAST(SUBSTR(bucket, INSTR(bucket, ':') + 1) AS INTEGER) < ?"
  ).bind(Math.floor(Date.now() / 60000) - 2).run().catch(() => undefined)
}

async function cronEvery20Min(env: Env): Promise<void> {
  // Auto-reset circuit breakers that have been open long enough
  const threshold = new Date(Date.now() - CIRCUIT_OPEN_MS).toISOString()
  await env.DB.prepare(
    "UPDATE circuit_breaker_state SET open = 0, fail_count = 0 WHERE open = 1 AND last_fail_at < ?"
  ).bind(threshold).run().catch(() => undefined)
  await audit(env, 'cron_circuit_reset', { threshold })
}

async function cronHourly(env: Env): Promise<void> {
  // Guardian drawdown check
  const portfolio = await getPortfolio(env)
  const starting  = n(env.PAPER_STARTING_BALANCE_USDT, 10000)
  const drawdown  = ((starting - portfolio.equity_usdt) / starting) * 100
  const maxDd     = n(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15)

  await env.DB.prepare(
    'UPDATE guardian_state SET drawdown_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).bind(Math.max(0, drawdown)).run().catch(() => undefined)

  if (drawdown >= maxDd) {
    await env.DB.prepare(
      "UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
    ).bind(`Auto-halt: drawdown ${drawdown.toFixed(2)}% ≥ max ${maxDd}%`).run()
    await audit(env, 'guardian_auto_halt', { drawdown, maxDd, equity: portfolio.equity_usdt })
  }

  // Purge market_snapshots older than 24h (keep DB lean)
  await env.DB.prepare(
    "DELETE FROM market_snapshots WHERE created_at < datetime('now', '-1 day')"
  ).run().catch(() => undefined)
}

async function cronDaily(env: Env): Promise<void> {
  // Daily earnings rollup audit entry
  const earned = await env.DB.prepare(
    "SELECT SUM(pnl) as daily_pnl FROM earnings WHERE date = ?"
  ).bind(day()).first<{ daily_pnl: number }>().catch(() => null)
  await audit(env, 'daily_rollup', { date: day(), daily_pnl: n(earned?.daily_pnl), ts: ts() })

  // Purge audit_trail older than 30 days
  await env.DB.prepare(
    "DELETE FROM audit_trail WHERE timestamp < datetime('now', '-30 days')"
  ).run().catch(() => undefined)
}

// ──────────────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

// CORS — use env CORS_ALLOWED_ORIGINS, fall back to same-origin wildcard
app.use('*', async (c, next) => {
  const origins = c.env.CORS_ALLOWED_ORIGINS
    ? c.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : ['*']
  return cors({
    origin: (origin) => {
      if (origins.includes('*')) return origin || '*'
      return origins.includes(origin) ? origin : origins[0]
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    maxAge: 86400,
  })(c, next)
})

// Global rate limit
app.use('*', async (c, next) => {
  const allowed = await checkRateLimit(c.env, c.req.raw)
  if (!allowed) return c.json({ error: 'Rate limit exceeded', retry_after: 60 }, 429)
  return next()
})

// ── LIVENESS & READINESS ─────────────────────────────────────────────────────

const healthPayload = async (env: Env) => {
  const g = await getGuardian(env)
  const cbRows = await env.DB.prepare('SELECT source, open FROM circuit_breaker_state')
    .all<{ source: string; open: number }>().catch(() => ({ results: [] }))
  const cbs: Record<string, boolean> = {}
  for (const row of cbRows.results ?? []) cbs[row.source] = bool(row.open)

  return {
    status:               'ok',
    service:              'crypto-signal-bot-worker',
    runtime:              'cloudflare-workers',
    provider:             'cloudflare-worker',
    ...safeRuntime(env),
    kill_switch_active:   bool(g.triggered),
    kill_switch_reason:   g.reason,
    guardian_triggered:   bool(g.triggered),
    halted:               bool(g.triggered),
    market_data_mode:     'live_public_paper',
    market_data_connected: true,
    market_data_source:   env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
    circuit_breakers:     cbs,
    ts: ts(),
  }
}

app.get('/healthz',   async (c) => c.json(await healthPayload(c.env)))
app.get('/health',    async (c) => c.json(await healthPayload(c.env)))
app.get('/api/health', async (c) => c.json({ status: 'ok', ...safeRuntime(c.env), ts: ts() }))

app.get('/ready', async (c) => {
  const g = await getGuardian(c.env)
  return c.json({ ready: true, status: 'ok', guardian_triggered: bool(g.triggered), ...safeRuntime(c.env), ts: ts() })
})

// ── RUNTIME STATUS ──────────────────────────────────────────────────────────

app.get('/runtime/status', (c) => c.json({
  ...safeRuntime(c.env),
  market_data_source:   c.env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
  starting_balance:     n(c.env.PAPER_STARTING_BALANCE_USDT, 10000),
  guardian_max_drawdown: n(c.env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
  runtime:              'cloudflare-workers',
  region:               'global-edge',
  ts: ts(),
}))

// ── MARKET DATA ────────────────────────────────────────────────────────────────────────────────

app.get('/market/feed/status', async (c) => {
  const cbRows = await c.env.DB.prepare('SELECT * FROM circuit_breaker_state')
    .all<CircuitBreakerRow>().catch(() => ({ results: [] as CircuitBreakerRow[] }))
  const breakers: Record<string, unknown> = {}
  for (const row of cbRows.results ?? []) {
    breakers[row.source] = { open: bool(row.open), fail_count: n(row.fail_count), last_fail_at: row.last_fail_at }
  }
  return c.json({
    primary:        'coinbase',
    fallback:       'binance',
    status:         'live_public',
    circuit_breakers: breakers,
    tracked_symbols: Object.keys(COIN_META),
    ...safeRuntime(c.env),
    ts: ts(),
  })
})

app.get('/market/price/:symbol', async (c) => {
  const result = await resolvePrice(c.env, c.req.param('symbol'))
  return c.json(result)
})

app.get('/market/prices', async (c) => {
  const symbols = (c.req.query('symbols') ?? Object.keys(COIN_META).slice(0, 6).join(','))
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)
  const results = await Promise.all(symbols.map(s => resolvePrice(c.env, s)))
  return c.json({ prices: results, count: results.length, ts: ts() })
})

app.get('/market/snapshots', async (c) => {
  const symbol = c.req.query('symbol')
  const limit  = Math.min(n(c.req.query('limit'), 50), 200)
  const query  = symbol
    ? 'SELECT * FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM market_snapshots ORDER BY created_at DESC LIMIT ?'
  const stmt   = symbol
    ? c.env.DB.prepare(query).bind(sym(symbol), limit)
    : c.env.DB.prepare(query).bind(limit)
  const rows = await stmt.all().catch(() => ({ results: [] }))
  return c.json({ snapshots: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() })
})

// ── SIGNAL ────────────────────────────────────────────────────────────────────

app.get('/signal/latest', async (c) => {
  const symbol = sym(c.req.query('symbol'))
  const row = await c.env.DB.prepare(
    'SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(symbol).first<SignalRow>().catch(() => null)

  if (row) return c.json({ ...row, action: row.side, signal: row.side, available: true, ...safeRuntime(c.env), ts: ts() })

  // Generate live signal from price action
  const px      = await resolvePrice(c.env, symbol)
  const history = await c.env.DB.prepare(
    'SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(symbol).all<{ price: number }>().catch(() => ({ results: [] }))
  const prices  = (history.results ?? []).map(r => n(r.price)).filter(p => p > 0)

  let side = 'HOLD', confidence = 0.5
  if (prices.length >= 5) {
    const emaFast = prices.slice(0, 3).reduce((s, v) => s + v, 0) / 3
    const emaSlow = prices.reduce((s, v) => s + v, 0) / prices.length
    if (emaFast > emaSlow * 1.002) { side = 'BUY';  confidence = 0.68 }
    if (emaFast < emaSlow * 0.998) { side = 'SELL'; confidence = 0.65 }
  }

  return c.json({
    symbol, timeframe: '5m', side, action: side, signal: side,
    confidence, entry_price: px.price,
    stop_loss: side === 'BUY' ? px.price * 0.98 : null,
    take_profit: side === 'BUY' ? px.price * 1.04 : null,
    strategy: 'worker_ema_crossover', available: true,
    price_source: px.source,
    ...safeRuntime(c.env), ts: ts(),
  })
})

app.get('/signal/history', async (c) => {
  const symbol = c.req.query('symbol')
  const limit  = Math.min(n(c.req.query('limit'), 50), 500)
  const query  = symbol
    ? 'SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM signals ORDER BY created_at DESC LIMIT ?'
  const stmt   = symbol
    ? c.env.DB.prepare(query).bind(sym(symbol), limit)
    : c.env.DB.prepare(query).bind(limit)
  const rows = await stmt.all<SignalRow>().catch(() => ({ results: [] as SignalRow[] }))
  return c.json({ signals: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() })
})

// ── EXCHANGE ───────────────────────────────────────────────────────────────

app.get('/exchange/status', (c) => c.json({
  status:              'paper_only',
  public_market_data:  c.env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
  live_execution:      false,
  ...safeRuntime(c.env),
  ts: ts(),
}))

app.get('/exchange/circuit-breakers', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM circuit_breaker_state')
    .all<CircuitBreakerRow>().catch(() => ({ results: [] as CircuitBreakerRow[] }))
  const adapters = (rows.results ?? []).map(r => ({
    source:      r.source,
    open:        bool(r.open),
    fail_count:  n(r.fail_count),
    last_fail_at: r.last_fail_at,
    reset_in_ms: r.last_fail_at
      ? Math.max(0, CIRCUIT_OPEN_MS - (ts() - new Date(r.last_fail_at).getTime()))
      : 0,
  }))
  // Ensure known adapters always appear
  for (const source of ['coinbase', 'binance']) {
    if (!adapters.find(a => a.source === source)) {
      adapters.push({ source, open: false, fail_count: 0, last_fail_at: null, reset_in_ms: 0 })
    }
  }
  return c.json({ adapters, count: adapters.length, ts: ts() })
})

// ── ORDERS ────────────────────────────────────────────────────────────────────

app.post('/orders', async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: 'Unauthorized', code: 401 }, 401)
  const input = await c.req.json().catch(() => ({})) as OrderInput
  const result = await placePaperOrder(c.env, input)
  return c.json(result.body, result.status)
})

app.post('/order', async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: 'Unauthorized', code: 401 }, 401)
  const input = await c.req.json().catch(() => ({})) as OrderInput
  const result = await placePaperOrder(c.env, input)
  return c.json(result.body, result.status)
})

app.get('/orders', async (c) => {
  const limit = Math.min(n(c.req.query('limit'), 50), 500)
  const rows  = await c.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?')
    .bind(limit).all<OrderRow>().catch(() => ({ results: [] as OrderRow[] }))
  const orders = (rows.results ?? []).map(o => ({ ...o, side: String(o.side).toUpperCase(), status: String(o.status).toUpperCase(), order_type: 'MARKET' }))
  return c.json({ orders, count: orders.length, ts: ts() })
})

app.get('/orders/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? LIMIT 1')
    .bind(c.req.param('id')).first<OrderRow>().catch(() => null)
  if (!row) return c.json({ error: 'Order not found' }, 404)
  return c.json({ ...row, side: String(row.side).toUpperCase(), status: String(row.status).toUpperCase() })
})

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────

app.get('/portfolio',         async (c) => c.json(await getPortfolio(c.env)))
app.get('/portfolio/summary', async (c) => c.json(await getPortfolio(c.env)))
app.get('/portfolio/positions', async (c) => {
  const positions = await openPositions(c.env)
  return c.json({ positions, count: positions.length, ...safeRuntime(c.env), ts: ts() })
})
app.get('/portfolio/balance', async (c) => {
  const balance = await getBalance(c.env)
  return c.json({ balance_usdt: balance, cash_usdt: balance, ...safeRuntime(c.env), ts: ts() })
})

// ── GUARDIAN ─────────────────────────────────────────────────────────────────

app.get('/guardian/status', async (c) => c.json(await getGuardian(c.env)))

app.post('/guardian/halt', async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: 'Unauthorized', code: 401 }, 401)
  const body   = await c.req.json().catch(() => ({})) as { reason?: string; scope?: string }
  const reason = body.reason ?? 'Manual halt via API'
  await ensureGuardian(c.env)
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).bind(reason).run()
  const result = { status: 'triggered', triggered: true, reason, ...safeRuntime(c.env), ts: ts() }
  await audit(c.env, 'guardian_halt', result)
  return c.json(result)
})

app.post('/guardian/reset', async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: 'Unauthorized', code: 401 }, 401)
  await ensureGuardian(c.env)
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 0, reason = NULL, error_count = 0, drawdown_pct = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).run()
  const result = { status: 'reset', triggered: false, ...safeRuntime(c.env), ts: ts() }
  await audit(c.env, 'guardian_reset', result)
  return c.json(result)
})

// Compat alias
app.post('/guardian/trigger', async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: 'Unauthorized', code: 401 }, 401)
  const body = await c.req.json().catch(() => ({})) as { reason?: string }
  await ensureGuardian(c.env)
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).bind(body.reason ?? 'API trigger').run()
  return c.json({ status: 'triggered', triggered: true, ...safeRuntime(c.env), ts: ts() })
})

// ── SURGE SCANNER ────────────────────────────────────────────────────────────

app.get('/surge/status', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM surge_events ORDER BY triggered_at DESC LIMIT 10'
  ).all().catch(() => ({ results: [] }))
  return c.json({
    scanner_active:  true,
    recent_surges:   rows.results ?? [],
    tracked_symbols: Object.keys(COIN_META),
    scan_interval_s: 300,
    ...safeRuntime(c.env),
    ts: ts(),
  })
})

app.get('/surge/history', async (c) => {
  const limit = Math.min(n(c.req.query('limit'), 50), 200)
  const rows  = await c.env.DB.prepare(
    'SELECT * FROM surge_events ORDER BY triggered_at DESC LIMIT ?'
  ).bind(limit).all().catch(() => ({ results: [] }))
  return c.json({ surges: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() })
})

// ── EARNINGS / PNL ────────────────────────────────────────────────────────────

app.get('/earnings', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT date, SUM(pnl) as pnl, MAX(cumulative_pnl) as cumulative_pnl FROM earnings GROUP BY date ORDER BY date DESC LIMIT 90'
  ).all().catch(() => ({ results: [] }))
  const total = await c.env.DB.prepare('SELECT SUM(pnl) as total, COUNT(*) as trades FROM earnings')
    .first<{ total: number; trades: number }>().catch(() => null)
  return c.json({
    daily: rows.results ?? [],
    total_pnl: n(total?.total),
    total_trades: n(total?.trades),
    ...safeRuntime(c.env),
    ts: ts(),
  })
})

app.get('/earnings/summary', async (c) => {
  const today_row = await c.env.DB.prepare("SELECT SUM(pnl) as pnl FROM earnings WHERE date = ?").bind(day()).first<{ pnl: number }>().catch(() => null)
  const total_row = await c.env.DB.prepare('SELECT SUM(pnl) as pnl FROM earnings').first<{ pnl: number }>().catch(() => null)
  return c.json({
    today_pnl:  n(today_row?.pnl),
    total_pnl:  n(total_row?.pnl),
    date:       day(),
    ...safeRuntime(c.env),
    ts: ts(),
  })
})

// ── AUDIT TRAIL ───────────────────────────────────────────────────────────────

app.get('/audit', async (c) => {
  const limit = Math.min(n(c.req.query('limit'), 100), 500)
  const rows  = await c.env.DB.prepare('SELECT * FROM audit_trail ORDER BY timestamp DESC LIMIT ?')
    .bind(limit).all().catch(() => ({ results: [] }))
  return c.json({ audit: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() })
})

// ── SYSTEM CONFIG ─────────────────────────────────────────────────────────────

app.get('/system/config', async (c) => {
  const rows = await c.env.DB.prepare('SELECT key, value FROM system_config')
    .all<{ key: string; value: string }>().catch(() => ({ results: [] }))
  const config: Record<string, string> = {}
  for (const row of rows.results ?? []) config[row.key] = row.value
  return c.json({ config, ...safeRuntime(c.env), ts: ts() })
})

app.post('/system/config', async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: 'Unauthorized', code: 401 }, 401)
  const body = await c.req.json().catch(() => ({})) as Record<string, string>
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      'INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP'
    ).bind(key, String(value), String(value)).run().catch(() => undefined)
  }
  await audit(c.env, 'system_config_update', body)
  return c.json({ status: 'ok', updated: Object.keys(body).length, ts: ts() })
})

// ── SAFETY BLOCKS (always 403 — hardcoded, cannot be overridden) ──────────────

app.post('/intent/live', (c) => c.json({ error: 'Live trading is disabled', code: 403, mode: PAPER }, 403))
app.post('/withdraw',    (c) => c.json({ error: 'Withdrawals are disabled', code: 403, mode: PAPER }, 403))
app.post('/live/order',  (c) => c.json({ error: 'Live orders are disabled', code: 403, mode: PAPER }, 403))
app.post('/live/trade',  (c) => c.json({ error: 'Live trades are disabled', code: 403, mode: PAPER }, 403))

app.route('/agent', agentRouter)

// ── CATCH-ALL ─────────────────────────────────────────────────────────────────

app.all('*', (c) => c.json({ error: 'Not found', path: new URL(c.req.url).pathname, ts: ts() }, 404))

// ──────────────────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const cron = event.cron
        // */5 * * * *  → every 5 min
        // */20 * * * * → every 20 min
        // 0 * * * *    → hourly
        // 0 0 * * *    → daily
        if (cron === '*/5 * * * *')  await cronEvery5Min(env)
        if (cron === '*/20 * * * *') await cronEvery20Min(env)
        if (cron === '0 * * * *')    await cronHourly(env)
        if (cron === '0 0 * * *')    await cronDaily(env)
        await audit(env, 'cron_fired', { cron, ts: ts() })
      } catch (err) {
        console.error('[cron error]', event.cron, err)
      }
    })())
  },
}
