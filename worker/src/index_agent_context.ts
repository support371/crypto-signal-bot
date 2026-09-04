import worker from './index_with_d1'
import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from './agent-context'

type RuntimeEnv = AgentContextEnv & {
  EXECUTION_EXCHANGE_PRIMARY?: string
  EXECUTION_EXCHANGE_SECONDARY?: string
  OPTIONAL_PUBLIC_DATA_EXCHANGE?: string
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
    schemaInitialization = (async () => {
      for (const statement of PAPER_SCHEMA_STATEMENTS) {
        await env.DB.prepare(statement).run()
      }
    })().catch((error) => {
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
