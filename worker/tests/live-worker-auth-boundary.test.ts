import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { requireApiKey, type Env } from '../src/index.ts'

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

test('backend API-key guard fails closed when the secret binding is absent', () => {
  const request = new Request('https://worker.example/orders')
  assert.equal(requireApiKey(env({ BACKEND_API_KEY: undefined }), request), false)
})

test('backend API-key guard accepts bearer and X-API-Key credentials only when exact', () => {
  const configured = env({ BACKEND_API_KEY: API_KEY })
  assert.equal(requireApiKey(configured, new Request('https://worker.example/orders')), false)
  assert.equal(requireApiKey(configured, new Request('https://worker.example/orders', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })), true)
  assert.equal(requireApiKey(configured, new Request('https://worker.example/orders', {
    headers: { 'X-API-Key': API_KEY },
  })), true)
})

test('privileged helper routes authenticate before accessing agent memory or D1', async () => {
  const source = await readFile(new URL('../src/index_with_d1.ts', import.meta.url), 'utf8')
  assert.match(source, /\(memoryMatch \|\| isPrivilegedD1Query\) && !requireApiKey\(env, request\)/)
  assert.ok(
    source.indexOf('!requireApiKey(env, request)') < source.indexOf('handleAgentMemory(request, env'),
    'authentication must run before agent-memory access',
  )
  assert.ok(
    source.indexOf('!requireApiKey(env, request)') < source.indexOf('handleReadonlyD1Query(request, env)'),
    'authentication must run before D1 query access',
  )
})
