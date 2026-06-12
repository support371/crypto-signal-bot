type OrderInput = {
  symbol?: string
  side?: string
  quantity?: number | string
  qty?: number | string
  amount?: number | string
  notional_usdt?: number | string
  price?: number | string
}

type PositionRow = {
  id: number
  symbol: string
  side: string
  quantity: number
  entry_price: number
  current_price: number | null
  pnl: number | null
  status: string
  created_at: string
}

const PAPER = 'paper'
const FALLBACK: Record<string, number> = { BTC: 100000, ETH: 3500, SOL: 160, BNB: 650 }

const n = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

const sym = (value?: string | null) => (value || 'BTC')
  .toUpperCase()
  .trim()
  .replace('/USDT', '')
  .replace('-USDT', '')
  .replace('/USD', '')
  .replace('-USD', '')

async function audit(env: Env, event: string, detail: unknown) {
  await env.DB.prepare('INSERT INTO audit_trail (event, detail) VALUES (?, ?)')
    .bind(event, typeof detail === 'string' ? detail : JSON.stringify(detail))
    .run()
    .catch(() => undefined)
}

async function getPrice(env: Env, rawSymbol?: string | null) {
  const symbol = sym(rawSymbol)
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`)
    const json = await res.json() as { data?: { amount?: string } }
    const price = n(json?.data?.amount, NaN)
    if (Number.isFinite(price) && price > 0) {
      await env.DB.prepare('INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)')
        .bind(symbol, price, 'coinbase')
        .run()
        .catch(() => undefined)
      return price
    }
  } catch {}

  const cached = await env.DB.prepare('SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1')
    .bind(symbol)
    .first<{ price: number }>()
    .catch(() => null)
  return cached?.price || FALLBACK[symbol] || 1
}

async function getBalance(env: Env) {
  const row = await env.DB.prepare("SELECT quantity FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1")
    .first<{ quantity: number }>()
    .catch(() => null)

  if (row?.quantity !== undefined) return n(row.quantity, 10000)

  const starting = n(env.PAPER_STARTING_BALANCE_USDT, 10000)
  await env.DB.prepare("INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES ('USDT', 'balance', ?, 1, 1, 0, 'balance')")
    .bind(starting)
    .run()
    .catch(() => undefined)
  return starting
}

async function setBalance(env: Env, value: number) {
  const row = await env.DB.prepare("SELECT id FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1")
    .first<{ id: number }>()
    .catch(() => null)

  if (row?.id) {
    await env.DB.prepare('UPDATE portfolio SET quantity = ? WHERE id = ?').bind(value, row.id).run()
  } else {
    await env.DB.prepare("INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES ('USDT', 'balance', ?, 1, 1, 0, 'balance')").bind(value).run()
  }
}

async function openPositions(env: Env, symbol: string) {
  const rows = await env.DB.prepare("SELECT * FROM portfolio WHERE status = 'open' AND symbol = ? ORDER BY created_at ASC")
    .bind(symbol)
    .all<PositionRow>()
    .catch(() => ({ results: [] as PositionRow[] }))
  return rows.results || []
}

async function recordPnl(env: Env, pnl: number) {
  const total = await env.DB.prepare('SELECT SUM(pnl) as total FROM earnings')
    .first<{ total: number }>()
    .catch(() => null)
  await env.DB.prepare('INSERT INTO earnings (date, pnl, cumulative_pnl) VALUES (?, ?, ?)')
    .bind(new Date().toISOString().split('T')[0], pnl, n(total?.total) + pnl)
    .run()
}

export async function executePaperOrder(env: Env, input: OrderInput) {
  const symbol = sym(input.symbol)
  const side = String(input.side || 'buy').toLowerCase()

  if (side !== 'buy' && side !== 'sell') {
    return { status: 400 as const, body: { error: 'Invalid side', mode: PAPER } }
  }

  const price = input.price ? n(input.price) : await getPrice(env, symbol)
  let quantity = n(input.quantity ?? input.qty)
  const notional = n(input.notional_usdt ?? input.amount)

  if (quantity <= 0 && notional > 0 && price > 0) quantity = notional / price
  if (quantity <= 0 || price <= 0) {
    return { status: 400 as const, body: { error: 'Missing valid quantity/notional or price', mode: PAPER } }
  }

  const guard = await env.DB.prepare('SELECT triggered FROM guardian_state WHERE id = 1')
    .first<{ triggered: number }>()
    .catch(() => null)
  if (guard?.triggered) {
    return { status: 403 as const, body: { error: 'Guardian kill switch active — paper trading paused', mode: PAPER } }
  }

  const cash = await getBalance(env)
  const notionalValue = quantity * price
  let realizedPnl = 0

  if (side === 'buy') {
    if (cash < notionalValue) {
      return { status: 400 as const, body: { error: 'Insufficient paper balance', balance_usdt: cash, required_usdt: notionalValue, mode: PAPER } }
    }

    await setBalance(env, cash - notionalValue)
    await env.DB.prepare('INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .bind(symbol, 'long', quantity, price, price, 'open')
      .run()
  } else {
    const lots = await openPositions(env, symbol)
    const available = lots.reduce((sum, lot) => sum + n(lot.quantity), 0)
    if (available < quantity) {
      return { status: 400 as const, body: { error: 'Insufficient paper position quantity', available_quantity: available, requested_quantity: quantity, mode: PAPER } }
    }

    let remaining = quantity
    let proceeds = 0

    for (const lot of lots) {
      if (remaining <= 0) break
      const lotQty = n(lot.quantity)
      const closedQty = Math.min(lotQty, remaining)
      const lotPnl = (price - n(lot.entry_price)) * closedQty
      const newQty = lotQty - closedQty

      realizedPnl += lotPnl
      proceeds += closedQty * price

      if (newQty <= 0.00000001) {
        await env.DB.prepare('UPDATE portfolio SET quantity = 0, current_price = ?, pnl = ?, status = ? WHERE id = ?')
          .bind(price, (price - n(lot.entry_price)) * lotQty, 'closed', lot.id)
          .run()
      } else {
        await env.DB.prepare('UPDATE portfolio SET quantity = ?, current_price = ?, pnl = ? WHERE id = ?')
          .bind(newQty, price, (price - n(lot.entry_price)) * newQty, lot.id)
          .run()
      }

      remaining -= closedQty
    }

    await setBalance(env, cash + proceeds)
    await recordPnl(env, realizedPnl)
  }

  await env.DB.prepare('INSERT INTO orders (symbol, side, quantity, price, status, mode) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(symbol, side, quantity, price, 'filled', PAPER)
    .run()

  const result = {
    status: 'filled',
    symbol,
    side,
    quantity,
    price,
    notional_usdt: notionalValue,
    realized_pnl: realizedPnl,
    mode: PAPER,
    live_trading_enabled: false,
    ts: Date.now(),
  }

  await audit(env, 'paper_trade', result)
  return { status: 200 as const, body: result }
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
