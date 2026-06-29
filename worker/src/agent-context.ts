import type { Env } from './index'

export type AgentContextEnv = Env & {
  AGENT_MEMORY?: KVNamespace
}

type SubcheckStatus = 'ok' | 'degraded' | 'unavailable'

type SubcheckResult = {
  status: SubcheckStatus
  detail: string | null
}

type GuardianRow = {
  triggered: number | boolean
  reason: string | null
  drawdown_pct: number | null
}

type CountRow = {
  cnt: number | null
  last_ts?: string | null
}

type CircuitBreakerRow = {
  source: string
  open: number | boolean
}

const PAPER_RUNTIME = {
  mode: 'paper',
  trading_mode: 'paper',
  exchange_mode: 'paper',
  network: 'testnet',
  allow_mainnet: false,
  live_trading_enabled: false,
  withdrawals_enabled: false,
} as const

function ok(detail: string | null = null): SubcheckResult {
  return { status: 'ok', detail }
}

function degraded(detail: string): SubcheckResult {
  return { status: 'degraded', detail }
}

function unavailable(detail: string): SubcheckResult {
  return { status: 'unavailable', detail }
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function corsHeaders(request: Request, env: Env): Headers {
  const configured = env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : ['*']
  const origin = request.headers.get('Origin') ?? '*'
  const allowedOrigin = configured.includes('*')
    ? origin
    : configured.includes(origin)
      ? origin
      : configured[0] ?? 'null'

  return new Headers({
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  })
}

function jsonResponse(
  request: Request,
  env: Env,
  payload: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, env),
  })
}

async function readGuardian(env: Env): Promise<{
  check: SubcheckResult
  triggered: boolean
  reason: string | null
  drawdownPct: number
}> {
  try {
    const row = await env.DB.prepare(
      'SELECT triggered, reason, drawdown_pct FROM guardian_state WHERE id = 1 LIMIT 1',
    ).first<GuardianRow>()

    if (!row) {
      return {
        check: unavailable('No guardian_state row found'),
        triggered: false,
        reason: null,
        drawdownPct: 0,
      }
    }

    const triggered = booleanValue(row.triggered)
    const reason = row.reason ?? null
    return {
      check: triggered
        ? degraded(`Guardian triggered${reason ? `: ${reason}` : ''}`)
        : ok('Guardian nominal'),
      triggered,
      reason,
      drawdownPct: numberValue(row.drawdown_pct),
    }
  } catch (error) {
    return {
      check: unavailable(`guardian_state query failed: ${String(error)}`),
      triggered: false,
      reason: null,
      drawdownPct: 0,
    }
  }
}

async function readSignals(env: Env): Promise<{
  check: SubcheckResult
  count: number
  lastTs: string | null
}> {
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS cnt, MAX(created_at) AS last_ts FROM signals',
    ).first<CountRow>()
    const count = numberValue(row?.cnt)
    return {
      check: ok(`${count} signal(s) available`),
      count,
      lastTs: row?.last_ts ?? null,
    }
  } catch (error) {
    return {
      check: unavailable(`signals query failed: ${String(error)}`),
      count: 0,
      lastTs: null,
    }
  }
}

async function readPortfolio(env: Env): Promise<{
  check: SubcheckResult
  openPositions: number
}> {
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM portfolio WHERE status = 'open' AND symbol != 'USDT'",
    ).first<CountRow>()
    const openPositions = numberValue(row?.cnt)
    return {
      check: ok(`${openPositions} open position(s)`),
      openPositions,
    }
  } catch (error) {
    return {
      check: unavailable(`portfolio query failed: ${String(error)}`),
      openPositions: 0,
    }
  }
}

async function readMarketFeed(env: Env): Promise<{
  check: SubcheckResult
  connected: boolean
  circuitBreakers: Record<string, boolean>
}> {
  const circuitBreakers: Record<string, boolean> = {
    coinbase: false,
    binance: false,
  }

  try {
    const rows = await env.DB.prepare(
      'SELECT source, open FROM circuit_breaker_state',
    ).all<CircuitBreakerRow>()
    for (const row of rows.results ?? []) {
      circuitBreakers[row.source] = booleanValue(row.open)
    }
  } catch {
    // Feed reachability remains the authoritative subcheck when breaker state is unavailable.
  }

  try {
    const response = await fetch(
      'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      { signal: AbortSignal.timeout(3000) },
    )
    if (!response.ok) {
      return {
        check: degraded(`Coinbase public feed returned HTTP ${response.status}`),
        connected: false,
        circuitBreakers,
      }
    }
    return {
      check: ok('Coinbase public feed reachable'),
      connected: true,
      circuitBreakers,
    }
  } catch (error) {
    return {
      check: unavailable(`Public market feed unreachable: ${String(error)}`),
      connected: false,
      circuitBreakers,
    }
  }
}

export async function handleAgentContextRequest(
  request: Request,
  env: AgentContextEnv,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  if (request.method !== 'GET') {
    return jsonResponse(request, env, { error: 'Method not allowed' }, 405)
  }

  let runtimeCheck: SubcheckResult
  try {
    await env.DB.prepare('SELECT 1 AS ok').first()
    runtimeCheck = ok('D1 reachable')
  } catch (error) {
    runtimeCheck = unavailable(`D1 error: ${String(error)}`)
  }

  const [guardian, signal, portfolio, marketFeed] = await Promise.all([
    readGuardian(env),
    readSignals(env),
    readPortfolio(env),
    readMarketFeed(env),
  ])

  const checks = [
    runtimeCheck,
    guardian.check,
    signal.check,
    portfolio.check,
    marketFeed.check,
  ]
  const allOk = checks.every((check) => check.status === 'ok')

  const payload = {
    ok: allOk,
    ts: Date.now(),
    memory_available: Boolean(env.AGENT_MEMORY),
    runtime: runtimeCheck,
    guardian: guardian.check,
    signal: signal.check,
    portfolio: portfolio.check,
    market_feed: marketFeed.check,
    ...PAPER_RUNTIME,
    kill_switch_active: guardian.triggered,
    kill_switch_reason: guardian.reason,
    guardian_triggered: guardian.triggered,
    halted: guardian.triggered,
    guardian_drawdown_pct: guardian.drawdownPct,
    active_signals_count: signal.count,
    last_signal_ts: signal.lastTs,
    open_positions_count: portfolio.openPositions,
    market_data_source: env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
    market_data_connected: marketFeed.connected,
    circuit_breakers: marketFeed.circuitBreakers,
  }

  return jsonResponse(request, env, payload, allOk ? 200 : 207)
}
