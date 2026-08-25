import { describe, expect, it } from 'vitest'

import worker from '../../src/index_with_d1'
import type { Env } from '../../src/index'

const API_KEY = 'test-backend-key'

function env(overrides: Partial<Env & { AGENT_MEMORY?: KVNamespace }> = {}) {
  return {
    DB: {
      prepare(sql: string) {
        if (sql !== 'SELECT 1 AS ok') throw new Error(`unexpected SQL: ${sql}`)
        return {
          bind() { return this },
          async all() { return { results: [{ ok: 1 }], success: true } },
        }
      },
    } as unknown as D1Database,
    STORAGE: {} as R2Bucket,
    AGENT_MEMORY: {
      async get() { return { release: 'verified' } },
    } as unknown as KVNamespace,
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
    ...overrides,
  }
}

describe('privileged Worker helper-route authentication', () => {
  it('rejects anonymous agent-memory and arbitrary D1 requests', async () => {
    const configured = env({ BACKEND_API_KEY: API_KEY })
    const context = {} as ExecutionContext

    for (const request of [
      new Request('https://worker.example/agent/memory/private-state'),
      new Request('https://worker.example/d1/query/readonly', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1 AS ok' }),
      }),
    ]) {
      const response = await worker.fetch(request, configured, context)
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized', code: 401 })
    }
  })

  it('preserves authenticated agent-memory and read-only D1 access', async () => {
    const configured = env({ BACKEND_API_KEY: API_KEY })
    const context = {} as ExecutionContext
    const headers = { 'X-API-Key': API_KEY }

    const memory = await worker.fetch(
      new Request('https://worker.example/agent/memory/release', { headers }),
      configured,
      context,
    )
    expect(memory.status).toBe(200)
    await expect(memory.json()).resolves.toMatchObject({
      key: 'release',
      value: { release: 'verified' },
    })

    const d1 = await worker.fetch(
      new Request('https://worker.example/d1/query/readonly', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1 AS ok' }),
      }),
      configured,
      context,
    )
    expect(d1.status).toBe(200)
    await expect(d1.json()).resolves.toEqual({
      result: { results: [{ ok: 1 }], success: true },
      readonly: true,
    })
  })
})
