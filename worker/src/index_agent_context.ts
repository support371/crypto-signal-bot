import worker from './index_with_d1'
import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from './agent-context'

type RuntimeEnv = AgentContextEnv & {
  EXECUTION_EXCHANGE_PRIMARY?: string
  EXECUTION_EXCHANGE_SECONDARY?: string
  OPTIONAL_PUBLIC_DATA_EXCHANGE?: string
  BACKEND_API_KEY?: string
}

let schemaInitialization: Promise<void> | null = null

const PAPER_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL, timeframe TEXT NOT NULL, side TEXT NOT NULL,
    confidence REAL NOT NULL, entry_price REAL, stop_loss REAL, take_profit REAL,
    strategy TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL,
    entry_price REAL NOT NULL, current_price REAL, pnl REAL DEFAULT 0,
    status TEXT DEFAULT 'open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL,
    price REAL NOT NULL, status TEXT DEFAULT 'filled', mode TEXT DEFAULT 'paper',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_trail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL, detail TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, pnl REAL DEFAULT 0, cumulative_pnl REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS guardian_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    triggered INTEGER DEFAULT 0, reason TEXT, error_count INTEGER DEFAULT 0,
    drawdown_pct REAL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL, price REAL NOT NULL, source TEXT NOT NULL,
    stale INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS surge_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL, change_pct REAL NOT NULL, allocation_pct REAL NOT NULL,
    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS circuit_breaker_state (
    source TEXT PRIMARY KEY,
    open INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    last_fail_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limit_counters (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT OR IGNORE INTO guardian_state (id, triggered, reason, error_count, drawdown_pct)
    VALUES (1, 0, NULL, 0, 0.0)`,
  `INSERT OR IGNORE INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status)
    VALUES ('USDT', 'balance', 10000, 1.0, 1.0, 0, 'balance')`,
  `INSERT OR IGNORE INTO circuit_breaker_state (source, open, fail_count) VALUES ('btcc', 0, 0)`,
  `INSERT OR IGNORE INTO circuit_breaker_state (source, open, fail_count) VALUES ('bitget', 0, 0)`,
  `INSERT OR IGNORE INTO circuit_breaker_state (source, open, fail_count) VALUES ('coinbase', 0, 0)`,
] as const

async function ensurePaperSchema(env: RuntimeEnv): Promise<void> {
  if (!schemaInitialization) {
    schemaInitialization = env.DB
      .batch(PAPER_SCHEMA_STATEMENTS.map((statement) => env.DB.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        schemaInitialization = null
        throw error
      })
  }
  await schemaInitialization
}

function executionMetadata(env: RuntimeEnv) {
  const primary = (env.EXECUTION_EXCHANGE_PRIMARY || 'btcc').trim().toLowerCase()
  const secondary = (env.EXECUTION_EXCHANGE_SECONDARY || 'bitget').trim().toLowerCase()
  return {
    execution_exchange_primary: primary,
    execution_exchange_secondary: secondary,
    execution_exchanges: [primary, secondary],
    market_data_public_exchange: (env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase').trim().toLowerCase(),
    optional_public_data_exchange: (env.OPTIONAL_PUBLIC_DATA_EXCHANGE || 'coinbase').trim().toLowerCase(),
  }
}

async function appendExecutionMetadata(response: Response, env: RuntimeEnv): Promise<Response> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return response

  const payload = await response.clone().json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return response

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({ ...payload, ...executionMetadata(env) }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function initializationFailure(error: unknown): Response {
  return Response.json({
    status: 'degraded',
    error: 'Database schema initialization failed',
    code: 'DATABASE_SCHEMA_INITIALIZATION_FAILED',
    detail: error instanceof Error ? error.message : String(error),
  }, { status: 503 })
}

async function workerJson(
  origin: string,
  path: string,
  env: RuntimeEnv,
  ctx: ExecutionContext,
  init?: RequestInit,
): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  const response = await worker.fetch(new Request(`${origin}${path}`, init), env, ctx)
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null
  return { response, body }
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function handleOneShotPaperDemo(
  request: Request,
  env: RuntimeEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.searchParams.get('confirm') !== 'paper-10k-e7d98447') {
    return Response.json({ ok: false, error: 'confirmation_required' }, { status: 403 })
  }

  const operatorKey = env.BACKEND_API_KEY?.trim()
  if (!operatorKey) {
    return Response.json({ ok: false, error: 'server_operator_key_not_configured' }, { status: 503 })
  }

  const origin = url.origin
  const [health, runtime, guardian, portfolio] = await Promise.all([
    workerJson(origin, '/health', env, ctx),
    workerJson(origin, '/runtime/status', env, ctx),
    workerJson(origin, '/guardian/status', env, ctx),
    workerJson(origin, '/portfolio/summary', env, ctx),
  ])

  if (!health.response.ok || !runtime.response.ok || !guardian.response.ok || !portfolio.response.ok) {
    return Response.json({
      ok: false,
      error: 'paper_test_dependencies_unavailable',
      statuses: {
        health: health.response.status,
        runtime: runtime.response.status,
        guardian: guardian.response.status,
        portfolio: portfolio.response.status,
      },
    }, { status: 503 })
  }

  const runtimeMode = String(runtime.body?.trading_mode ?? runtime.body?.mode ?? health.body?.mode ?? '').toLowerCase()
  const portfolioMode = String(portfolio.body?.mode ?? '').toLowerCase()
  const allowMainnet = runtime.body?.allow_mainnet === true || health.body?.allow_mainnet === true
  const liveTrading = runtime.body?.live_trading_enabled === true || health.body?.live_trading_enabled === true
  const withdrawals = runtime.body?.withdrawals_enabled === true || health.body?.withdrawals_enabled === true
  const guardianTriggered = guardian.body?.triggered === true || guardian.body?.kill_switch_active === true

  if (
    runtimeMode !== 'paper'
    || portfolioMode !== 'paper'
    || allowMainnet
    || liveTrading
    || withdrawals
    || guardianTriggered
  ) {
    return Response.json({
      ok: false,
      error: 'paper_safety_precondition_failed',
      safety: {
        runtime_mode: runtimeMode || 'unknown',
        portfolio_mode: portfolioMode || 'unknown',
        allow_mainnet: allowMainnet,
        live_trading_enabled: liveTrading,
        withdrawals_enabled: withdrawals,
        guardian_triggered: guardianTriggered,
      },
    }, { status: 409 })
  }

  const cashBefore = finiteNumber(portfolio.body?.cash_usdt ?? portfolio.body?.balance_usdt)
  const positionCount = finiteNumber(
    portfolio.body?.position_count
      ?? (Array.isArray(portfolio.body?.open_positions) ? portfolio.body.open_positions.length : undefined)
      ?? (Array.isArray(portfolio.body?.positions) ? portfolio.body.positions.length : 0),
  )

  if (
    cashBefore === null
    || Math.abs(cashBefore - 10000) > 10
    || positionCount !== 0
  ) {
    return Response.json({
      ok: false,
      error: 'one_shot_demo_precondition_not_met',
      note: 'No trade was submitted. The one-shot test only runs against a clean ~10,000 USDT paper wallet with no open position.',
      cash_before: cashBefore,
      position_count: positionCount,
    }, { status: 409 })
  }

  const price = await workerJson(origin, '/market/price/BTC', env, ctx)
  const referencePrice = finiteNumber(price.body?.price)
  if (!price.response.ok || referencePrice === null || referencePrice <= 0) {
    return Response.json({ ok: false, error: 'btc_reference_price_unavailable' }, { status: 503 })
  }

  const quantity = Number((500 / referencePrice).toFixed(8))
  const trade = await workerJson(origin, '/orders', env, ctx, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': operatorKey,
    },
    body: JSON.stringify({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity,
      price: referencePrice,
      notional_usdt: 500,
      idempotency_key: 'one-shot-demo-e7d98447',
    }),
  })

  if (!trade.response.ok || String(trade.body?.status ?? '').toUpperCase() !== 'FILLED') {
    return Response.json({
      ok: false,
      error: 'paper_trade_not_filled',
      upstream_status: trade.response.status,
      upstream: trade.body,
    }, { status: trade.response.status || 502 })
  }

  const after = await workerJson(origin, '/portfolio/summary', env, ctx)
  if (!after.response.ok) {
    return Response.json({
      ok: false,
      error: 'paper_trade_filled_but_portfolio_verification_failed',
      trade: trade.body,
    }, { status: 502 })
  }

  return Response.json({
    ok: true,
    test: 'ONE_SHOT_10K_DEMO_PAPER_BUY',
    safety: {
      mode: 'paper',
      network: 'testnet',
      real_funds: false,
      withdrawals: false,
      provider_mutation: false,
    },
    before: {
      cash_usdt: cashBefore,
      position_count: positionCount,
    },
    trade: trade.body,
    after: {
      cash_usdt: finiteNumber(after.body?.cash_usdt ?? after.body?.balance_usdt),
      equity_usdt: finiteNumber(after.body?.equity_usdt),
      position_count: finiteNumber(
        after.body?.position_count
          ?? (Array.isArray(after.body?.open_positions) ? after.body.open_positions.length : undefined)
          ?? (Array.isArray(after.body?.positions) ? after.body.positions.length : 0),
      ),
    },
  })
}

const METADATA_PATHS = new Set([
  '/healthz',
  '/health',
  '/runtime/status',
  '/agent/context',
  '/market/feed/status',
  '/exchange/circuit-breakers',
])

export default {
  async fetch(
    request: Request,
    env: RuntimeEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      await ensurePaperSchema(env)
    } catch (error) {
      return initializationFailure(error)
    }

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/operator/paper-demo/e7d98447') {
      return handleOneShotPaperDemo(request, env, ctx)
    }

    const response = url.pathname === '/agent/context'
      ? await handleAgentContextRequest(request, env)
      : await worker.fetch(request, env, ctx)

    return METADATA_PATHS.has(url.pathname)
      ? appendExecutionMetadata(response, env)
      : response
  },

  async scheduled(event: ScheduledEvent, env: RuntimeEnv, ctx: ExecutionContext): Promise<void> {
    await ensurePaperSchema(env)
    await worker.scheduled(event, env, ctx)
  },
}
