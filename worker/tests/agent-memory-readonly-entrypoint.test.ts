import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { beforeEach, test, vi } from 'vitest'

const workerFetch = vi.fn()
const workerScheduled = vi.fn()

vi.mock('../src/index_with_d1', () => ({
  default: {
    fetch: workerFetch,
    scheduled: workerScheduled,
  },
}))

import entrypoint from '../src/index_agent_context'

type TestEnv = {
  CORS_ALLOWED_ORIGINS?: string
}

const ctx = {} as ExecutionContext

beforeEach(() => {
  workerFetch.mockReset()
  workerScheduled.mockReset()
  workerFetch.mockResolvedValue(
    new Response(JSON.stringify({ value: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
})

test('wrangler keeps the read-only wrapper as the deployed Worker entrypoint', async () => {
  const wrangler = await readFile(
    new URL('../../wrangler.toml', import.meta.url),
    'utf8',
  )

  assert.match(wrangler, /main\s*=\s*"worker\/src\/index_agent_context\.ts"/)
})

test('agent memory GET delegates to the underlying reader and authorizes an allowed origin', async () => {
  const env: TestEnv = { CORS_ALLOWED_ORIGINS: 'https://allowed.example' }
  const request = new Request('https://worker.example/agent/memory/demo', {
    headers: { Origin: 'https://allowed.example' },
  })

  const response = await entrypoint.fetch(request, env as never, ctx)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://allowed.example')
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Vary'), 'Origin')
  assert.equal(workerFetch.mock.calls.length, 1)
})

test('agent memory does not authorize an unlisted browser origin', async () => {
  const env: TestEnv = { CORS_ALLOWED_ORIGINS: 'https://allowed.example' }
  const request = new Request('https://worker.example/agent/memory/demo', {
    headers: { Origin: 'https://unlisted.example' },
  })

  const response = await entrypoint.fetch(request, env as never, ctx)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(workerFetch.mock.calls.length, 1)
})

test('agent memory preflight is non-mutating and only advertises GET and OPTIONS', async () => {
  const env: TestEnv = { CORS_ALLOWED_ORIGINS: 'https://allowed.example' }
  const request = new Request('https://worker.example/agent/memory/demo', {
    method: 'OPTIONS',
    headers: { Origin: 'https://allowed.example' },
  })

  const response = await entrypoint.fetch(request, env as never, ctx)

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://allowed.example')
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')
  assert.equal(workerFetch.mock.calls.length, 0)
})

test('agent memory rejects mutation methods before they reach the underlying Worker', async () => {
  const env: TestEnv = { CORS_ALLOWED_ORIGINS: 'https://allowed.example' }

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    workerFetch.mockClear()
    const response = await entrypoint.fetch(
      new Request('https://worker.example/agent/memory/demo', { method }),
      env as never,
      ctx,
    )

    assert.equal(response.status, 405, `${method} must fail closed`)
    assert.equal(response.headers.get('Allow'), 'GET, OPTIONS')
    assert.equal(workerFetch.mock.calls.length, 0, `${method} must not reach worker.fetch`)
  }
})

test('non-agent-memory routes continue to delegate without wrapper CORS changes', async () => {
  const env: TestEnv = { CORS_ALLOWED_ORIGINS: 'https://allowed.example' }
  const request = new Request('https://worker.example/health')

  const response = await entrypoint.fetch(request, env as never, ctx)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(workerFetch.mock.calls.length, 1)
})

test('scheduled jobs remain delegated unchanged to the underlying Worker', () => {
  assert.equal(entrypoint.scheduled, workerScheduled)
})
