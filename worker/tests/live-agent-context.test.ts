import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from '../src/agent-context.ts'

class FakeStatement {
  private readonly sql: string
  private readonly fail: boolean

  constructor(sql: string, fail: boolean) {
    this.sql = sql
    this.fail = fail
  }

  async first<T>(): Promise<T | null> {
    if (this.fail) throw new Error('D1 unavailable')
    if (this.sql.includes('SELECT 1 AS ok')) return { ok: 1 } as T
    if (this.sql.includes('FROM guardian_state')) {
      return { triggered: 0, reason: null, drawdown_pct: 0 } as T
    }
    if (this.sql.includes('FROM signals')) {
      return { cnt: 3, last_ts: '2026-07-20T01:00:00.000Z' } as T
    }
    if (this.sql.includes('FROM portfolio')) return { cnt: 2 } as T
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.fail) throw new Error('D1 unavailable')
    if (this.sql.includes('FROM circuit_breaker_state')) {
      return {
        results: [
          { source: 'coinbase', open: 0 },
          { source: 'binance', open: 1 },
        ] as T[],
      }
    }
    return { results: [] }
  }
}

class FakeD1 {
  private readonly fail: boolean

  constructor(fail = false) {
    this.fail = fail
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql, this.fail)
  }
}

function env(database: FakeD1, memoryAvailable = true): AgentContextEnv {
  return {
    DB: database as unknown as D1Database,
    STORAGE: {} as R2Bucket,
    AGENT_MEMORY: memoryAvailable ? ({} as KVNamespace) : undefined,
    TRADING_MODE: 'paper',
    EXCHANGE_MODE: 'paper',
    NETWORK: 'testnet',
    ALLOW_MAINNET: 'false',
    MARKET_DATA_PUBLIC_EXCHANGE: 'coinbase',
    PAPER_STARTING_BALANCE_USDT: '10000',
    GUARDIAN_MAX_DRAWDOWN_PCT: '15',
    GUARDIAN_MAX_API_ERRORS: '10',
    GUARDIAN_MAX_FAILED_ORDERS: '5',
    RATE_LIMIT_RPM: '120',
    CORS_ALLOWED_ORIGINS: 'https://crypto-signal-bot-indol.vercel.app',
  }
}

test('agent context aggregates direct subchecks and exposes Certification Mode safely', async () => {
  const response = await handleAgentContextRequest(
    new Request('https://worker.example/agent/context', {
      headers: { Origin: 'https://crypto-signal-bot-indol.vercel.app' },
    }),
    env(new FakeD1()),
    {
      now: () => 1_784_510_000_000,
      fetcher: async () => Response.json({ data: { amount: '118000.00' } }),
    },
  )

  assert.equal(response.status, 200)
  const payload = await response.json() as Record<string, any>
  assert.equal(payload.ok, true)
  assert.equal(payload.display_mode, 'certification')
  assert.equal(payload.certification_mode, true)
  assert.equal(payload.mode, 'paper')
  assert.equal(payload.allow_mainnet, false)
  assert.equal(payload.live_trading_enabled, false)
  assert.equal(payload.provider_mutation_enabled, false)
  assert.equal(payload.real_funds_enabled, false)
  assert.equal(payload.withdrawals_enabled, false)
  assert.equal(payload.memory_available, true)
  assert.equal(payload.runtime.status, 'ok')
  assert.equal(payload.guardian.status, 'ok')
  assert.equal(payload.signal.status, 'ok')
  assert.equal(payload.portfolio.status, 'ok')
  assert.equal(payload.market_feed.status, 'ok')
  assert.equal(payload.active_signals_count, 3)
  assert.equal(payload.open_positions_count, 2)
  assert.equal(payload.circuit_breakers.binance, true)
})

test('agent context reports independent failures without inventing availability', async () => {
  const response = await handleAgentContextRequest(
    new Request('https://worker.example/agent/context'),
    env(new FakeD1(true), false),
    {
      now: () => 1_784_510_000_000,
      fetcher: async () => {
        throw new Error('feed unavailable')
      },
    },
  )

  assert.equal(response.status, 207)
  const payload = await response.json() as Record<string, any>
  assert.equal(payload.ok, false)
  assert.equal(payload.memory_available, false)
  for (const name of ['runtime', 'guardian', 'signal', 'portfolio', 'market_feed']) {
    assert.equal(payload[name].status, 'unavailable', name)
  }
  assert.equal(payload.allow_mainnet, false)
  assert.equal(payload.live_trading_enabled, false)
  assert.equal(payload.provider_mutation_enabled, false)
  assert.equal(payload.real_funds_enabled, false)
  assert.equal(payload.withdrawals_enabled, false)
})

test('all Worker entrypoints avoid self-fetch aggregation for agent context', async () => {
  const source = await readFile(
    new URL('../src/index_with_d1.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /handleAgentContextRequest\(request, env\)/)
  assert.doesNotMatch(source, /fetch\(`\$\{base\}\/runtime\/status`\)/)
  assert.doesNotMatch(source, /Promise\.allSettled\(\[/)
})
