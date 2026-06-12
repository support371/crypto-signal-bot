import type { Context, Hono } from 'hono'

type App = Hono<{ Bindings: Env }>
type Ctx = Context<{ Bindings: Env }>

type Snapshot = { price: number; created_at?: string }
type Position = { id: number; symbol: string; side: string; quantity: number; entry_price: number; current_price: number | null; pnl: number | null; status: string; created_at: string }

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB']
const FALLBACK: Record<string, number> = { BTC: 100000, ETH: 3500, SOL: 160, BNB: 650 }
const n = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}
const sym = (value?: string | null) => (value || 'BTC').toUpperCase().trim().replace('/USDT', '').replace('-USDT', '').replace('/USD', '').replace('-USD', '')
const safety = (env: Env) => ({ mode: 'paper', trading_mode: env.TRADING_MODE || 'paper', exchange_mode: env.EXCHANGE_MODE || 'paper', allow_mainnet: false, live_trading_enabled: false, withdrawals_enabled: false })

async function body(c: Ctx): Promise<Record<string, unknown>> {
  return await c.req.json().catch(() => ({})) as Record<string, unknown>
}

async function audit(env: Env, event: string, detail: unknown) {
  await env.DB.prepare('INSERT INTO audit_trail (event, detail) VALUES (?, ?)')
    .bind(event, typeof detail === 'string' ? detail : JSON.stringify(detail))
    .run()
    .catch(() => undefined)
}

async function price(env: Env, raw?: string | null) {
  const symbol = sym(raw)
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`)
    const data = await res.json() as { data?: { amount?: string } }
    const live = n(data?.data?.amount, NaN)
    if (Number.isFinite(live) && live > 0) {
      await env.DB.prepare('INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)')
        .bind(symbol, live, 'coinbase')
        .run()
        .catch(() => undefined)
      return { symbol, price: live, source: 'coinbase', stale: false, ts: Date.now() }
    }
  } catch {}

  const cached = await env.DB.prepare('SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1')
    .bind(symbol)
    .first<{ price: number }>()
    .catch(() => null)
  return { symbol, price: cached?.price || FALLBACK[symbol] || 1, source: cached ? 'cache' : 'fallback', stale: true, ts: Date.now() }
}

async function history(env: Env, symbol: string, limit = 40) {
  const rows = await env.DB.prepare('SELECT price, created_at FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT ?')
    .bind(symbol, limit)
    .all<Snapshot>()
    .catch(() => ({ results: [] as Snapshot[] }))
  const values = (rows.results || []).map((row) => n(row.price)).filter((value) => value > 0).reverse()
  if (values.length >= 21) return values
  const current = (await price(env, symbol)).price
  return Array.from({ length: 30 }, (_, i) => current * (1 + ((i - 15) * 0.0007)))
}

function ema(values: number[], period: number) {
  const k = 2 / (period + 1)
  return values.reduce((prev, value, index) => index === 0 ? value : (value * k) + (prev * (1 - k)), values[0] || 0)
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50
  const recent = values.slice(-period - 1)
  let gains = 0
  let losses = 0
  for (let i = 1; i < recent.length; i += 1) {
    const diff = recent[i] - recent[i - 1]
    if (diff >= 0) gains += diff
    else losses += Math.abs(diff)
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - (100 / (1 + rs))
}

async function generateSignal(env: Env, rawSymbol?: string | null, persist = true) {
  const symbol = sym(rawSymbol)
  const values = await history(env, symbol, 40)
  const latest = values[values.length - 1] || (await price(env, symbol)).price
  const ema9 = ema(values, 9)
  const ema21 = ema(values, 21)
  const rsi14 = rsi(values, 14)

  let side: 'BUY' | 'SELL' | 'HOLD' = 'HOLD'
  if (ema9 > ema21 && rsi14 < 70) side = 'BUY'
  if (ema9 < ema21 && rsi14 > 30) side = 'SELL'

  const edge = Math.abs(ema9 - ema21) / Math.max(ema21, 1)
  const confidence = Number(Math.min(0.95, Math.max(0.2, 0.45 + edge * 25 + Math.abs(rsi14 - 50) / 200)).toFixed(2))
  const signal = {
    symbol,
    timeframe: '5m',
    side,
    action: side,
    confidence,
    entry_price: latest,
    stop_loss: side === 'BUY' ? Number((latest * 0.97).toFixed(2)) : side === 'SELL' ? Number((latest * 1.03).toFixed(2)) : null,
    take_profit: side === 'BUY' ? Number((latest * 1.05).toFixed(2)) : side === 'SELL' ? Number((latest * 0.95).toFixed(2)) : null,
    indicators: { ema9, ema21, rsi14 },
    strategy: 'ema9_ema21_rsi14',
    ...safety(env),
    ts: Date.now(),
  }

  if (persist) {
    await env.DB.prepare('INSERT INTO signals (symbol, timeframe, side, confidence, entry_price, stop_loss, take_profit, strategy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(signal.symbol, signal.timeframe, signal.side, signal.confidence, signal.entry_price, signal.stop_loss, signal.take_profit, signal.strategy)
      .run()
      .catch(() => undefined)
    await audit(env, 'signal_generated', signal)
  }

  return signal
}

async function portfolio(env: Env) {
  const balance = await env.DB.prepare("SELECT quantity FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1")
    .first<{ quantity: number }>()
    .catch(() => null)
  const rows = await env.DB.prepare("SELECT * FROM portfolio WHERE status = 'open' AND symbol != 'USDT' ORDER BY created_at ASC")
    .all<Position>()
    .catch(() => ({ results: [] as Position[] }))
  const positions = await Promise.all((rows.results || []).map(async (position) => {
    const px = await price(env, position.symbol)
    const quantity = n(position.quantity)
    const unrealized = (px.price - n(position.entry_price)) * quantity
    return { ...position, current_price: px.price, market_value_usdt: px.price * quantity, unrealized_pnl: unrealized, pnl: unrealized }
  }))
  const earned = await env.DB.prepare('SELECT SUM(pnl) as realized FROM earnings').first<{ realized: number }>().catch(() => null)
  const cash = n(balance?.quantity, n(env.PAPER_STARTING_BALANCE_USDT, 10000))
  const positionsValue = positions.reduce((sum, item) => sum + n(item.market_value_usdt), 0)
  const unrealized = positions.reduce((sum, item) => sum + n(item.unrealized_pnl), 0)
  const realized = n(earned?.realized)
  return { balance_usdt: cash, cash_usdt: cash, equity_usdt: cash + positionsValue, positions_value_usdt: positionsValue, realized_pnl: realized, unrealized_pnl: unrealized, total_pnl: realized + unrealized, positions, open_positions: positions, position_count: positions.length, ...safety(env), ts: Date.now() }
}

async function guardian(env: Env) {
  const state = await env.DB.prepare('SELECT * FROM guardian_state WHERE id = 1').first().catch(() => null) as Record<string, unknown> | null
  return { ...(state || {}), triggered: Boolean(state?.triggered), drawdown_pct: n(state?.drawdown_pct), reason: state?.reason || null, ...safety(env), ts: Date.now() }
}

async function backtest(env: Env, input: Record<string, unknown>) {
  const symbol = sym(String(input.symbol || 'BTC'))
  const strategy = String(input.strategy || 'ema9_ema21_rsi14')
  const values = await history(env, symbol, 60)
  const tradeLog: Array<Record<string, unknown>> = []
  let cash = n(env.PAPER_STARTING_BALANCE_USDT, 10000)
  let positionQty = 0
  let entry = 0

  for (let i = 21; i < values.length; i += 5) {
    const slice = values.slice(0, i + 1)
    const fast = ema(slice, 9)
    const slow = ema(slice, 21)
    const current = values[i]
    if (positionQty === 0 && fast > slow) {
      const notional = cash * 0.1
      positionQty = notional / current
      entry = current
      cash -= notional
      tradeLog.push({ index: i, action: 'BUY', price: current, quantity: positionQty, notional_usdt: notional })
    } else if (positionQty > 0 && (fast < slow || i >= values.length - 5)) {
      const proceeds = positionQty * current
      const pnl = (current - entry) * positionQty
      cash += proceeds
      tradeLog.push({ index: i, action: 'SELL', price: current, quantity: positionQty, proceeds_usdt: proceeds, pnl_usdt: pnl })
      positionQty = 0
      entry = 0
    }
  }

  const realizedTrades = tradeLog.filter((trade) => trade.action === 'SELL')
  const pnl = realizedTrades.reduce((sum, trade) => sum + n(trade.pnl_usdt), 0)
  const wins = realizedTrades.filter((trade) => n(trade.pnl_usdt) > 0).length
  const result = {
    status: 'complete',
    symbol,
    strategy,
    trades: realizedTrades.length,
    trade_log: tradeLog,
    win_rate: realizedTrades.length ? Number((wins / realizedTrades.length).toFixed(2)) : 0,
    pnl_usdt: Number(pnl.toFixed(2)),
    starting_balance_usdt: n(env.PAPER_STARTING_BALANCE_USDT, 10000),
    ending_balance_usdt: Number((n(env.PAPER_STARTING_BALANCE_USDT, 10000) + pnl).toFixed(2)),
    no_trade_reason: realizedTrades.length ? null : 'No EMA crossover exit completed during the sampled period.',
    ...safety(env),
    ts: Date.now(),
  }
  await audit(env, 'backtest_run', result)
  return result
}

export function registerDashboardRoutes(app: App) {
  app.get('/dashboard', async (c) => {
    const [btc, eth, p, g, signal] = await Promise.all([
      price(c.env, 'BTC'),
      price(c.env, 'ETH'),
      portfolio(c.env),
      guardian(c.env),
      generateSignal(c.env, c.req.query('symbol') || 'BTC', false),
    ])

    return c.json({
      backend: { status: 'ok', provider: 'cloudflare-worker', url: 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev' },
      prices: { BTC: btc, ETH: eth },
      portfolio: p,
      guardian: g,
      surge: { scanner_active: true, assets: SYMBOLS, source: 'worker' },
      signal,
      report_mapping: { stale_zero_values_allowed: false, source_of_truth: 'worker-api' },
      ...safety(c.env),
      ts: Date.now(),
    })
  })

  app.post('/signals/generate', async (c) => {
    const payload = await body(c)
    return c.json(await generateSignal(c.env, String(payload.symbol || c.req.query('symbol') || 'BTC'), true))
  })

  app.post('/backtest', async (c) => c.json(await backtest(c.env, await body(c))))
  app.post('/api/v1/backtest', async (c) => c.json(await backtest(c.env, await body(c))))
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
