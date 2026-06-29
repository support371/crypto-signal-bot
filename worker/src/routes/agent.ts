import { Hono } from 'hono'
import type { Env } from '../index'

interface SubcheckResult {
  status: 'ok' | 'degraded' | 'unavailable'
  detail: string | null
}

interface AgentContextResponse {
  ok: boolean
  ts: number
  runtime: SubcheckResult
  guardian: SubcheckResult
  signal: SubcheckResult
  portfolio: SubcheckResult
  market_feed: SubcheckResult
  mode: string
  trading_mode: string
  allow_mainnet: boolean
  live_trading_enabled: boolean
  kill_switch_active: boolean
  kill_switch_reason: string | null
  guardian_triggered: boolean
  halted: boolean
  active_signals_count: number
  last_signal_ts: string | null
  open_positions_count: number
  market_data_source: string
  market_data_connected: boolean
  circuit_breakers: Record<string, boolean>
}

function requireApiKey() {
  return async (c: any, next: () => Promise<void>) => {
    const key =
      c.req.header('X-API-Key') ??
      c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!c.env.BACKEND_API_KEY || !key || key !== c.env.BACKEND_API_KEY) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  }
}

function ok(detail: string | null = null): SubcheckResult {
  return { status: 'ok', detail }
}
function degraded(detail: string): SubcheckResult {
  return { status: 'degraded', detail }
}
function unavailable(detail: string): SubcheckResult {
  return { status: 'unavailable', detail }
}

export const agentRouter = new Hono<{ Bindings: Env }>()

agentRouter.use('/context', requireApiKey())

agentRouter.get('/context', async (c) => {
  const env = c.env
  const now = Date.now()

  // Runtime
  let runtimeCheck: SubcheckResult
  try {
    await env.DB.prepare('SELECT 1').first()
    runtimeCheck = ok('D1 reachable')
  } catch (e: any) {
    runtimeCheck = unavailable(`D1 error: ${e?.message ?? 'unknown'}`)
  }

  // Guardian
  let guardianCheck: SubcheckResult
  let killSwitchActive = false
  let killSwitchReason: string | null = null
  let guardianTriggered = false
  let halted = false
  try {
    const guardian = await env.DB
      .prepare(`SELECT triggered, reason
                FROM guardian_state WHERE id = 1 LIMIT 1`)
      .first<{
        triggered: number | boolean
        reason: string | null
      }>()
    if (guardian) {
      guardianTriggered = guardian.triggered === 1 || guardian.triggered === true
      killSwitchActive = guardianTriggered
      killSwitchReason = guardian.reason
      halted = guardianTriggered
      guardianCheck = guardianTriggered
        ? degraded(`kill_switch:${killSwitchActive} guardian:${guardianTriggered} halted:${halted}`)
        : ok('Guardian nominal')
    } else {
      guardianCheck = unavailable('No guardian_state row found')
    }
  } catch (e: any) {
    guardianCheck = unavailable(`guardian_state query failed: ${e?.message ?? 'unknown'}`)
  }

  // Signal
  let signalCheck: SubcheckResult
  let activeSignalsCount = 0
  let lastSignalTs: string | null = null
  try {
    const row = await env.DB
      .prepare(`SELECT COUNT(*) as cnt, MAX(created_at) as last_ts
                FROM signals`)
      .first<{ cnt: number; last_ts: string | null }>()
    activeSignalsCount = row?.cnt ?? 0
    lastSignalTs = row?.last_ts ?? null
    signalCheck = ok(`${activeSignalsCount} signal(s) available`)
  } catch (e: any) {
    signalCheck = unavailable(`signals query failed: ${e?.message ?? 'unknown'}`)
  }

  // Portfolio
  let portfolioCheck: SubcheckResult
  let openPositionsCount = 0
  try {
    const row = await env.DB
      .prepare(`SELECT COUNT(*) as cnt
                FROM portfolio
                WHERE status = 'open' AND symbol != 'USDT'`)
      .first<{ cnt: number }>()
    openPositionsCount = row?.cnt ?? 0
    portfolioCheck = ok(`${openPositionsCount} open position(s)`)
  } catch (e: any) {
    portfolioCheck = unavailable(`portfolio query failed: ${e?.message ?? 'unknown'}`)
  }

  // Market feed
  let marketFeedCheck: SubcheckResult
  let marketDataConnected = false
  const circuitBreakers: Record<string, boolean> = {
    coinbase: false,
    binance: false,
  }
  try {
    const breakerRows = await env.DB
      .prepare('SELECT source, open FROM circuit_breaker_state')
      .all<{ source: string; open: number }>()
    for (const row of breakerRows.results ?? []) {
      circuitBreakers[row.source] = row.open === 1
    }
  } catch {
    // Feed reachability remains the authoritative subcheck if breaker state is unavailable.
  }

  try {
    const res = await fetch(
      'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      { signal: AbortSignal.timeout(3000) }
    )
    if (res.ok) {
      marketDataConnected = true
      marketFeedCheck = ok('Coinbase public feed reachable')
    } else {
      circuitBreakers.coinbase = true
      marketFeedCheck = degraded(`Coinbase HTTP ${res.status}`)
    }
  } catch (e: any) {
    circuitBreakers.coinbase = true
    marketFeedCheck = unavailable(`Feed unreachable: ${e?.message ?? 'unknown'}`)
  }

  const allOk = [
    runtimeCheck,
    guardianCheck,
    signalCheck,
    portfolioCheck,
    marketFeedCheck,
  ].every((subcheck) => subcheck.status === 'ok')

  const body: AgentContextResponse = {
    ok: allOk,
    ts: now,
    runtime: runtimeCheck,
    guardian: guardianCheck,
    signal: signalCheck,
    portfolio: portfolioCheck,
    market_feed: marketFeedCheck,
    mode: env.TRADING_MODE ?? 'paper',
    trading_mode: env.TRADING_MODE ?? 'paper',
    allow_mainnet: env.ALLOW_MAINNET === 'true',
    live_trading_enabled: false,
    kill_switch_active: killSwitchActive,
    kill_switch_reason: killSwitchReason,
    guardian_triggered: guardianTriggered,
    halted,
    active_signals_count: activeSignalsCount,
    last_signal_ts: lastSignalTs,
    open_positions_count: openPositionsCount,
    market_data_source: env.MARKET_DATA_PUBLIC_EXCHANGE || 'coinbase',
    market_data_connected: marketDataConnected,
    circuit_breakers: circuitBreakers,
  }

  return c.json(body, allOk ? 200 : 207)
})
