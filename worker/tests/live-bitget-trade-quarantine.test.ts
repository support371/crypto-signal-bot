import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../src/index_bitget_trade_quarantine.ts'

type CallableHandler = (
  request: Request,
  environment?: unknown,
) => Response | Promise<Response>

async function invoke(method: string, environment?: unknown): Promise<Response> {
  return (worker.fetch as CallableHandler)(
    new Request('https://quarantine.invalid/anything', { method }),
    environment,
  )
}

test('trade quarantine reports only permanent locks for safe methods', async () => {
  const response = await invoke('GET')
  const body = await response.json() as Record<string, unknown>

  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Bitget-Trade-Quarantine'), 'locked')
  assert.equal(body.status, 'TRADE_CREDENTIALS_QUARANTINED')
  assert.equal(body.credentialsValidated, false)
  assert.equal(body.credentialAccessAllowed, false)
  assert.equal(body.signingAllowed, false)
  assert.equal(body.providerTransportConfigured, false)
  assert.equal(body.providerMutationAllowed, false)
  assert.equal(body.executionAllowed, false)
  assert.equal(body.automaticRetryAllowed, false)
  assert.equal(body.withdrawalsAllowed, false)

  const head = await invoke('HEAD')
  assert.equal(head.status, 503)
  assert.equal(await head.text(), '')
})

test('trade quarantine rejects every mutation method', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await invoke(method)
    const body = await response.json() as Record<string, unknown>
    assert.equal(response.status, 403, method)
    assert.equal(body.providerMutationAllowed, false, method)
    assert.equal(body.executionAllowed, false, method)
  }
})

test('handler cannot read, serialize, or validate injected secret-like bindings', async () => {
  let reads = 0
  const sentinel = 'must-never-appear-in-response'
  const binding = {
    async get() {
      reads += 1
      return sentinel
    },
  }

  const response = await invoke('GET', {
    BITGET_TRADE_API_KEY: binding,
    BITGET_TRADE_API_SECRET: binding,
    BITGET_TRADE_API_PASSPHRASE: binding,
  })
  const body = await response.text()

  assert.equal(reads, 0)
  assert.equal(body.includes(sentinel), false)
  assert.equal(body.includes('BITGET_TRADE_API'), false)
})
