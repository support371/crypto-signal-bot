import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { registerCompatibilityRoutes } from './compat'
import { registerRenderParityRoutes } from './renderParity'

const app = new Hono<{ Bindings: Env }>()
const PAPER = 'paper'
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB']
const FALLBACK: Record<string, number> = { BTC: 100000, ETH: 3500, SOL: 160, BNB: 650 }

type PositionRow = { id: number; symbol: string; side: string; quantity: number; entry_price: number; current_price: number | null; pnl: number | null; status: string; created_at: string }
type OrderInput = { symbol?: string; side?: string; quantity?: number | string; qty?: number | string; amount?: number | string; notional_usdt?: number | string; price?: number | string }

const now = () => Date.now()
const n = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}
const normalizeSymbol = (value?: string | null) => (value || 'BTC')
  .toUpperCase()
  .trim()
  .replace(/[-/](USDT|USD)$/i, '')
  .replace(/(USDT|USD)$/i, '')

const safeRuntime = (env: Env) => ({
  trading_mode: env.TRADING_MODE || PAPER,
  exchange_mode: env.EXCHANGE_MODE || PAPER,
  mode: PAPER,
  network: env.NETWORK || 'testnet',
  allow_mainnet: false,
  live_trading_enabled: false,
  withdrawals_enabled: false,
})

async function audit(env: Env, event: string, detail: unknown) {
  await env.DB.prepare('INSERT INTO audit_trail (event, detail) VALUES (?, ?)')
    .bind(event, typeof detail === 'string' ? detail : JSON.stringify(detail))
    .run()
    .catch(() => undefined)
}

async function resolveMarketPrice(env: Env, value?: string | null, explicit?: unknown) {
  const symbol = normalizeSymbol(value)
  const provided = n(explicit, NaN)
  if (Number.isFinite(provided) && provided > 0) {
    return { symbol, price: provided, source: 'request', stale: false, ts: now() }
  }

  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json() as { data?: { amount?: string } }
    const price = n(data?.data?.amount, NaN)
    if (Number.isFinite(price) && price > 0) {
      await env.DB.prepare(
        'INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)'
      ).bind(symbol, price, 'coinbase').run().catch(() => undefined)
      return { symbol, price, source: 'coinbase', stale: false, ts: now() }
    }
  } catch (e) {
    // Fall back to cache or deterministic paper price.
  }

  const cached = await env.DB.prepare(
    'SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(symbol).first<{ price: number }>().catch(() => null)
  return { symbol, price: cached?.price || FALLBACK[symbol] || 1, source: cached ? 'cache' : 'fallback', stale: true, ts: now() }
}

async function getBalance(env: Env) {
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

async function setBalance(env: Env, value: number) {
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

async function openPositions(env: Env, symbol?: string) {
  const normalized = symbol ? normalizeSymbol(symbol) : null
  const query = normalized
    ? "SELECT * FROM portfolio WHERE status = 'open' AND symbol = ? ORDER BY created_at ASC"
    : "SELECT * FROM portfolio WHERE status = 'open' AND symbol != 'USDT' ORDER BY created_at ASC"
  const stmt = normalized ? env.DB.prepare(query).bind(normalized) : env.DB.prepare(query)
  const rows = await stmt.all<PositionRow>().catch(() => ({ results: [] as PositionRow[] }))
  return rows.results || []
}

async function recordPnl(env: Env, pnl: number) {
  const date = new Date().toISOString().split('T')[0]
  const total = await env.DB.prepare('SELECT SUM(pnl) as total FROM earnings').first<{ total: number }>().catch(() => null)
  await env.DB.prepare('INSERT INTO earnings (date, pnl, cumulative_pnl) VALUES (?, ?, ?)')
    .bind(date, pnl, n(total?.total) + pnl)
    .run()
}

async function placePaperOrder(env: Env, input: OrderInput) {
  const price = await resolveMarketPrice(env, input.symbol, input.price)
  const symbol = price.symbol
  const side = String(input.side || '').toUpperCase()
  let quantity = n(input.quantity ?? input.qty)
  const notional = n(input.notional_usdt ?? input.amount)

  if (quantity <= 0 && notional > 0 && price.price > 0) quantity = notional / price.price
  if (!symbol || (side !== 'BUY' && side !== 'SELL')) return { status: 400 as const, body: { error: 'Invalid symbol or side', mode: PAPER } }
  if (quantity <= 0 || price.price <= 0) return { status: 400 as const, body: { error: 'Missing valid quantity or price', mode: PAPER } }

  const guardian = await env.DB.prepare('SELECT triggered FROM guardian_state WHERE id = 1').first<{ triggered: number }>().catch(() => null)
  if (guardian?.triggered) return { status: 403 as const, body: { error: 'Guardian kill switch active — trading paused', mode: PAPER } }

  const cash = await getBalance(env)
  const value = quantity * price.price
  let realized = 0

  if (side === 'BUY') {
    if (cash < value) return { status: 400 as const, body: { error: 'Insufficient paper balance', balance_usdt: cash, required_usdt: value, mode: PAPER } }
    await setBalance(env, cash - value)
    await env.DB.prepare(
      'INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).bind(symbol, 'long', quantity, price.price, price.price, 'open').run()
  } else {
    const lots = await openPositions(env, symbol)
    const available = lots.reduce((sum, lot) => sum + n(lot.quantity), 0)
    if (available < quantity) return { status: 400 as const, body: { error: 'Insufficient paper position quantity', available_quantity: available, requested_quantity: quantity, mode: PAPER } }
    let remaining = quantity
    for (const lot of lots) {
      if (remaining <= 0) break
      const lotQty = n(lot.quantity)
      const closedQty = Math.min(lotQty, remaining)
      const lotPnl = (price.price - n(lot.entry_price)) * closedQty
      realized += lotPnl
      const nextQty = lotQty - closedQty
      if (nextQty <= 0.00000001) {
        await env.DB.prepare('UPDATE portfolio SET quantity = 0, current_price = ?, pnl = ?, status = ? WHERE id = ?')
          .bind(price.price, (price.price - n(lot.entry_price)) * lotQty, 'closed', lot.id)
          .run()
      } else {
        await env.DB.prepare('UPDATE portfolio SET quantity = ?, current_price = ?, pnl = ? WHERE id = ?')
          .bind(nextQty, price.price, (price.price - n(lot.entry_price)) * nextQty, lot.id)
          .run()
      }
      remaining -= closedQty
    }
    await setBalance(env, cash + value)
    await recordPnl(env, realized)
  }

  await env.DB.prepare(
    'INSERT INTO orders (symbol, side, quantity, price, status, mode) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(symbol, side, quantity, price.price, 'FILLED', PAPER).run()

  const result = { status: 'FILLED', symbol, side, quantity, price: price.price, fill_price: price.price, notional_usdt: value, realized_pnl: realized, mode: PAPER, ts: now() }
  await audit(env, 'paper_trade', result)
  return { status: 200 as const, body: result }
}

async function healthPayload(env: Env) {
  const guardian = await env.DB.prepare('SELECT triggered, reason FROM guardian_state WHERE id = 1').first<{ triggered: number; reason?: string | null }>().catch(() => null)
  const triggered = Boolean(guardian?.triggered)
  return {
    status: 'ok',
    service: 'crypto-signal-bot-worker',
    runtime: 'cloudflare-workers',
    ...safeRuntime(env),
    kill_switch_active: triggered,
    kill_switch_reason: guardian?.reason || null,
    guardian_triggered: triggered,
    halted: triggered,
    market_data_mode: 'live_public_paper',
    market_data_connected: true,
    market_data_source: env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
    ts: now(),
  }
}

app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}))

// ── LIVENESS ──────────────────────────────────────────
app.get('/healthz', async (c) => c.json(await healthPayload(c.env)))
app.get('/health',  async (c) => c.json(await healthPayload(c.env)))

// ── RUNTIME STATUS ────────────────────────────────────
app.get('/runtime/status', (c) => c.json({
  ...safeRuntime(c.env),
  market_data_source: c.env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
  starting_balance: n(c.env.PAPER_STARTING_BALANCE_USDT, 10000),
  guardian_max_drawdown: n(c.env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
  runtime: 'cloudflare-workers',
  region: 'global-edge',
  ts: now(),
}))

// ── BLOCKED LIVE ROUTES ───────────────────────────────
app.post('/intent/live', (c) => c.json({ error: 'Live trading is disabled', code: 403, mode: PAPER }, 403))
app.post('/withdraw',    (c) => c.json({ error: 'Withdrawals are disabled', code: 403, mode: PAPER }, 403))

// ── MARKET DATA ───────────────────────────────────────
app.get('/market/price/:symbol', async (c) => {
  const price = await resolveMarketPrice(c.env, c.req.param('symbol'))
  return c.json(price)
})

app.get('/market/feed/status', async (c) => {
  const adapters = ['coinbase', 'binance', 'bitget', 'btcc', 'coingecko']
  return c.json({
    primary: 'coinbase',
    market_data_mode: 'live_public_paper',
    adapters: adapters.map(a => ({
      name: a,
      status: a === 'coinbase' ? 'healthy' : 'standby',
      circuit_breaker: 'closed'
    })),
    ...safeRuntime(c.env),
    ts: now()
  })
})

// ── SIGNALS ───────────────────────────────────────────
app.get('/signals', async (c) => {
  const symbol = normalizeSymbol(c.req.query('symbol') || 'BTC')
  const signals = await c.env.DB.prepare(
    'SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(symbol).first()
  return c.json(signals || {
    symbol, side: 'FLAT', confidence: 0,
    entry_price: null, stop_loss: null, take_profit: null,
    message: 'No signal generated yet', mode: PAPER, ts: now()
  })
})

app.get('/signals/history', async (c) => {
  const symbol = normalizeSymbol(c.req.query('symbol') || 'BTC')
  const limit = parseInt(c.req.query('limit') || '20')
  const rows = await c.env.DB.prepare(
    'SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(symbol, limit).all()
  return c.json(rows.results || [])
})

// ── PORTFOLIO ─────────────────────────────────────────
app.get('/portfolio/summary', async (c) => {
  const positions = await openPositions(c.env)
  const priced = await Promise.all(positions.map(async (pos) => {
    const px = await resolveMarketPrice(c.env, pos.symbol)
    const qty = n(pos.quantity)
    const pnl = (px.price - n(pos.entry_price)) * qty
    return { ...pos, symbol: normalizeSymbol(pos.symbol), current_price: px.price, market_value_usdt: qty * px.price, unrealized_pnl: pnl, pnl }
  }))
  const balance = await getBalance(c.env)
  const earnings = await c.env.DB.prepare('SELECT SUM(pnl) as total_pnl FROM earnings').first<{ total_pnl: number }>().catch(() => null)
  const positionsValue = priced.reduce((sum, pos) => sum + n(pos.market_value_usdt), 0)
  const unrealized = priced.reduce((sum, pos) => sum + n(pos.unrealized_pnl), 0)
  const realized = n(earnings?.total_pnl)
  return c.json({
    balance_usdt: balance,
    cash_usdt: balance,
    equity_usdt: balance + positionsValue,
    open_positions: priced,
    positions: priced,
    position_count: priced.length,
    realized_pnl: realized,
    unrealized_pnl: unrealized,
    total_pnl: realized + unrealized,
    mode: PAPER,
    ts: now()
  })
})

app.get('/portfolio/trades', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM orders ORDER BY created_at DESC LIMIT 50'
  ).all()
  return c.json(rows.results || [])
})

// ── PAPER TRADE EXECUTION ─────────────────────────────
app.post('/intent/paper', async (c) => {
  const payload = await c.req.json().catch(() => ({})) as OrderInput
  const result = await placePaperOrder(c.env, payload)
  return c.json(result.body, result.status)
})

// ── GUARDIAN ──────────────────────────────────────────
app.get('/guardian/status', async (c) => {
  const state = await c.env.DB.prepare(
    'SELECT * FROM guardian_state WHERE id = 1'
  ).first<{ triggered?: number | boolean, reason?: string | null, error_count?: number, drawdown_pct?: number, updated_at?: string }>()

  const drawdownLimit = n(c.env.GUARDIAN_MAX_DRAWDOWN_PCT, 15)

  return c.json({
    ...(state || {}),
    triggered: !!state?.triggered,
    reason: state?.reason || null,
    error_count: state?.error_count || 0,
    drawdown_pct: state?.drawdown_pct || 0,
    max_drawdown_pct: drawdownLimit,
    max_api_errors: parseInt(c.env.GUARDIAN_MAX_API_ERRORS || '10'),
    max_failed_orders: parseInt(c.env.GUARDIAN_MAX_FAILED_ORDERS || '5'),
    ...safeRuntime(c.env),
    ts: now()
  })
})

app.post('/guardian/kill', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { reason?: string }
  const reason = body?.reason || 'Manual kill switch activated'
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).bind(reason).run()
  await audit(c.env, 'guardian_kill', reason)
  return c.json({ status: 'triggered', reason, mode: PAPER, ts: now() })
})

app.post('/guardian/reset', async (c) => {
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 0, reason = NULL, error_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).run()
  await audit(c.env, 'guardian_reset', 'Manual reset')
  return c.json({ status: 'reset', triggered: false, mode: PAPER, ts: now() })
})

// ── SURGE SCANNER ─────────────────────────────────────
app.get('/surge/status', async (c) => {
  const events = await c.env.DB.prepare(
    'SELECT * FROM surge_events ORDER BY triggered_at DESC LIMIT 10'
  ).all()
  const snapshots = await c.env.DB.prepare(
    "SELECT symbol, price, created_at FROM market_snapshots WHERE symbol IN ('BTC','ETH','SOL','BNB') ORDER BY created_at DESC LIMIT 4"
  ).all()
  return c.json({
    scanner_active: true,
    assets: SYMBOLS,
    window_minutes: 20,
    stop_loss_pct: 5,
    recent_events: events.results || [],
    latest_snapshots: snapshots.results || [],
    mode: PAPER,
    ts: now()
  })
})

// ── EXCHANGE CIRCUIT BREAKERS ─────────────────────────
app.get('/exchange/circuit-breakers', (c) => c.json({
  adapters: [
    { name: 'coinbase',   status: 'closed', failures: 0 },
    { name: 'binance',    status: 'closed', failures: 0 },
    { name: 'bitget',     status: 'closed', failures: 0 },
    { name: 'btcc',       status: 'closed', failures: 0 },
    { name: 'coingecko',  status: 'closed', failures: 0 }
  ],
  ...safeRuntime(c.env),
  ts: now()
}))

// ── AUDIT TRAIL ───────────────────────────────────────
app.get('/audit', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM audit_trail ORDER BY timestamp DESC LIMIT 50'
  ).all()
  return c.json(rows.results || [])
})

// ── BACKTEST ──────────────────────────────────────────
app.get('/backtest', async (c) => {
  const symbol = normalizeSymbol(c.req.query('symbol') || 'BTC')
  return c.json({
    symbol, status: 'ready',
    message: 'Backtest engine available — submit POST /backtest with strategy config',
    supported_strategies: ['ema_cross', 'rsi_mean_reversion', 'macd_momentum'],
    mode: PAPER,
    ts: now()
  })
})

// ── RENDER / FASTAPI COMPATIBILITY ROUTES ─────────────
registerCompatibilityRoutes(app)
registerRenderParityRoutes(app)

// ── CRON TRIGGERS ─────────────────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = event.cron

    if (cron === '*/5 * * * *') {
      for (const sym of SYMBOLS) {
        try {
          await resolveMarketPrice(env, sym)
        } catch (err) {
          // Ignore errors during scheduled price fetch.
        }
      }
    }
    if (cron === '*/20 * * * *') {
      for (const sym of SYMBOLS) {
        try {
          const current = await env.DB.prepare(
            'SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
          ).bind(sym).first<{ price: number }>()
          const ago = await env.DB.prepare(
            "SELECT price FROM market_snapshots WHERE symbol = ? AND created_at <= datetime('now', '-20 minutes') ORDER BY created_at DESC LIMIT 1"
          ).bind(sym).first<{ price: number }>()
          if (current && ago && ago.price > 0) {
            const changePct = ((current.price - ago.price) / ago.price) * 100
            if (changePct >= 5) {
              const allocationPct = changePct >= 15 ? 10 : 5
              await env.DB.prepare(
                'INSERT INTO surge_events (symbol, change_pct, allocation_pct) VALUES (?, ?, ?)'
              ).bind(sym, changePct, allocationPct).run()
              await audit(env, 'surge_detected', { sym, changePct, allocationPct })
            }
          }
        } catch (err) {
          // Ignore errors during scheduled surge check.
        }
      }
    }

    if (cron === '0 * * * *') {
      const earnings = await env.DB.prepare(
        'SELECT SUM(pnl) as total FROM earnings'
      ).first<{ total: number }>()
      const starting = n(env.PAPER_STARTING_BALANCE_USDT, 10000)
      const drawdown = ((starting - (starting + n(earnings?.total))) / starting) * 100
      if (drawdown >= n(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15)) {
        await env.DB.prepare(
          'UPDATE guardian_state SET triggered = 1, reason = ?, drawdown_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).bind(`Max drawdown reached: ${drawdown.toFixed(2)}%`, drawdown).run()
      }
    }

    if (cron === '0 0 * * *') {
      const today = new Date().toISOString().split('T')[0]
      await env.DB.prepare(
        'INSERT OR IGNORE INTO earnings (date, pnl, cumulative_pnl) VALUES (?, 0, 0)'
      ).bind(today).run()
    }
  }
}

interface Env {
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
}
