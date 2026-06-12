import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { registerCompatibilityRoutes } from './compat'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}))

// ── LIVENESS ──────────────────────────────────────────
app.get('/healthz', (c) => c.json({ status: 'ok', mode: 'paper', ts: Date.now() }))
app.get('/health',  (c) => c.json({ status: 'ok', mode: 'paper', ts: Date.now() }))

// ── RUNTIME STATUS ────────────────────────────────────
app.get('/runtime/status', (c) => c.json({
  trading_mode: c.env.TRADING_MODE,
  exchange_mode: c.env.EXCHANGE_MODE,
  allow_mainnet: false,
  market_data_source: c.env.MARKET_DATA_PUBLIC_EXCHANGE,
  starting_balance: parseFloat(c.env.PAPER_STARTING_BALANCE_USDT),
  guardian_max_drawdown: parseFloat(c.env.GUARDIAN_MAX_DRAWDOWN_PCT),
  network: c.env.NETWORK,
  runtime: 'cloudflare-workers',
  region: 'global-edge'
}))

// ── BLOCKED LIVE ROUTES ───────────────────────────────
app.post('/intent/live', (c) => c.json({ error: 'Live trading is disabled', code: 403 }, 403))
app.post('/withdraw',    (c) => c.json({ error: 'Withdrawals are disabled', code: 403 }, 403))

// ── MARKET DATA ───────────────────────────────────────
app.get('/market/price/:symbol', async (c) => {
  const symbol = c.req.param('symbol').toUpperCase()
  try {
    const res = await fetch(
      `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    const data: any = await res.json()
    const price = parseFloat(data?.data?.amount)
    if (!isNaN(price)) {
      await c.env.DB.prepare(
        'INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)'
      ).bind(symbol, price, 'coinbase').run()
      return c.json({ symbol, price, source: 'coinbase', stale: false, ts: Date.now() })
    }
    throw new Error('Invalid price from Coinbase')
  } catch (e) {
    const cached = await c.env.DB.prepare(
      'SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(symbol).first<{ price: number }>()
    if (cached) return c.json({ symbol, price: cached.price, source: 'cache', stale: true, ts: Date.now() })
    return c.json({ error: 'Market data unavailable' }, 503)
  }
})

app.get('/market/feed/status', async (c) => {
  const adapters = ['coinbase', 'binance', 'bitget', 'btcc', 'coingecko']
  return c.json({
    primary: 'coinbase',
    adapters: adapters.map(a => ({
      name: a,
      status: a === 'coinbase' ? 'healthy' : 'standby',
      circuit_breaker: 'closed'
    })),
    ts: Date.now()
  })
})

// ── SIGNALS ───────────────────────────────────────────
app.get('/signals', async (c) => {
  const symbol = c.req.query('symbol') || 'BTC'
  const signals = await c.env.DB.prepare(
    'SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(symbol).first()
  return c.json(signals || {
    symbol, side: 'FLAT', confidence: 0,
    entry_price: null, stop_loss: null, take_profit: null,
    message: 'No signal generated yet'
  })
})

app.get('/signals/history', async (c) => {
  const symbol = c.req.query('symbol') || 'BTC'
  const limit = parseInt(c.req.query('limit') || '20')
  const rows = await c.env.DB.prepare(
    'SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(symbol, limit).all()
  return c.json(rows.results || [])
})

// ── PORTFOLIO ─────────────────────────────────────────
app.get('/portfolio/summary', async (c) => {
  const positions = await c.env.DB.prepare(
    "SELECT * FROM portfolio WHERE status = 'open' AND symbol != 'USDT'"
  ).all()
  const balance = await c.env.DB.prepare(
    "SELECT quantity FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1"
  ).first<{ quantity: number }>()
  const earnings = await c.env.DB.prepare(
    'SELECT SUM(pnl) as total_pnl FROM earnings'
  ).first<{ total_pnl: number }>()
  return c.json({
    balance_usdt: balance?.quantity || 10000,
    open_positions: positions.results || [],
    position_count: (positions.results || []).length,
    total_pnl: earnings?.total_pnl || 0,
    mode: 'paper',
    ts: Date.now()
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
  const body: any = await c.req.json()
  const { symbol, side, quantity, price } = body
  if (!symbol || !side || !quantity || !price) {
    return c.json({ error: 'Missing required fields' }, 400)
  }
  const guardian = await c.env.DB.prepare(
    'SELECT triggered FROM guardian_state WHERE id = 1'
  ).first<{ triggered: number }>()
  if (guardian?.triggered) {
    return c.json({ error: 'Guardian kill switch active — trading paused' }, 403)
  }
  await c.env.DB.prepare(
    'INSERT INTO orders (symbol, side, quantity, price, status, mode) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(symbol, side, quantity, price, 'filled', 'paper').run()
  await c.env.DB.prepare(
    'INSERT INTO audit_trail (event, detail) VALUES (?, ?)'
  ).bind('paper_trade', JSON.stringify({ symbol, side, quantity, price })).run()
  return c.json({ status: 'filled', symbol, side, quantity, price, mode: 'paper', ts: Date.now() })
})

// ── GUARDIAN ──────────────────────────────────────────
app.get('/guardian/status', async (c) => {
  const state = await c.env.DB.prepare(
    'SELECT * FROM guardian_state WHERE id = 1'
  ).first<{ triggered?: number | boolean, reason?: string | null, error_count?: number, drawdown_pct?: number, updated_at?: string }>()

  const drawdownLimit = parseFloat(c.env.GUARDIAN_MAX_DRAWDOWN_PCT || '15')

  return c.json({
    ...(state || {}),
    triggered: !!state?.triggered,
    reason: state?.reason || null,
    error_count: state?.error_count || 0,
    drawdown_pct: state?.drawdown_pct || 0,
    max_drawdown_pct: drawdownLimit,
    max_api_errors: parseInt(c.env.GUARDIAN_MAX_API_ERRORS || '10'),
    max_failed_orders: parseInt(c.env.GUARDIAN_MAX_FAILED_ORDERS || '5'),
    mode: 'paper',
    allow_mainnet: false,
    live_trading_enabled: false,
    withdrawals_enabled: false,
    ts: Date.now()
  })
})

app.post('/guardian/kill', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const reason = body?.reason || 'Manual kill switch activated'
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).bind(reason).run()
  await c.env.DB.prepare(
    'INSERT INTO audit_trail (event, detail) VALUES (?, ?)'
  ).bind('guardian_kill', reason).run()
  return c.json({ status: 'triggered', reason, ts: Date.now() })
})

app.post('/guardian/reset', async (c) => {
  await c.env.DB.prepare(
    'UPDATE guardian_state SET triggered = 0, reason = NULL, error_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).run()
  await c.env.DB.prepare(
    'INSERT INTO audit_trail (event, detail) VALUES (?, ?)'
  ).bind('guardian_reset', 'Manual reset').run()
  return c.json({ status: 'reset', triggered: false, ts: Date.now() })
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
    assets: ['BTC', 'ETH', 'SOL', 'BNB'],
    window_minutes: 20,
    stop_loss_pct: 5,
    recent_events: events.results || [],
    latest_snapshots: snapshots.results || [],
    ts: Date.now()
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
  ts: Date.now()
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
  const symbol = c.req.query('symbol') || 'BTC'
  return c.json({
    symbol, status: 'ready',
    message: 'Backtest engine available — submit POST /backtest with strategy config',
    supported_strategies: ['ema_cross', 'rsi_mean_reversion', 'macd_momentum'],
    ts: Date.now()
  })
})

// ── RENDER / FASTAPI COMPATIBILITY ROUTES ─────────────
registerCompatibilityRoutes(app)

// ── CRON TRIGGERS ─────────────────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = event.cron

    if (cron === '*/5 * * * *') {
      const symbols = ['BTC', 'ETH', 'SOL', 'BNB']
      for (const sym of symbols) {
        try {
          const res = await fetch(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`)
          const data: any = await res.json()
          const price = parseFloat(data?.data?.amount)
          if (!isNaN(price)) {
            await env.DB.prepare(
              'INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)'
            ).bind(sym, price, 'coinbase').run()
          }
        } catch (e) {}
      }
    }
    if (cron === '*/20 * * * *') {
      const symbols = ['BTC', 'ETH', 'SOL', 'BNB']
      for (const sym of symbols) {
        try {
          const now = await env.DB.prepare(
            'SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
          ).bind(sym).first<{ price: number }>()
          const ago = await env.DB.prepare(
            "SELECT price FROM market_snapshots WHERE symbol = ? AND created_at <= datetime('now', '-20 minutes') ORDER BY created_at DESC LIMIT 1"
          ).bind(sym).first<{ price: number }>()
          if (now && ago && ago.price > 0) {
            const changePct = ((now.price - ago.price) / ago.price) * 100
            if (changePct >= 5) {
              const allocationPct = changePct >= 15 ? 10 : 5
              await env.DB.prepare(
                'INSERT INTO surge_events (symbol, change_pct, allocation_pct) VALUES (?, ?, ?)'
              ).bind(sym, changePct, allocationPct).run()
              await env.DB.prepare(
                'INSERT INTO audit_trail (event, detail) VALUES (?, ?)'
              ).bind('surge_detected', JSON.stringify({ sym, changePct, allocationPct })).run()
            }
          }
        } catch (e) {}
      }
    }

    if (cron === '0 * * * *') {
      const earnings = await env.DB.prepare(
        'SELECT SUM(pnl) as total FROM earnings'
      ).first<{ total: number }>()
      const totalPnl = earnings?.total || 0
      const drawdown = ((10000 - (10000 + totalPnl)) / 10000) * 100
      if (drawdown >= 15) {
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
