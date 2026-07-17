import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BitgetReadOnlyClient,
  BitgetReadOnlyClientError,
  assertBitgetReadOnlyAuthorities,
  buildBitgetPrehash,
} from '../src/live/adapters/bitget/read-only-client.ts'
import { BITGET_SPOT_ENDPOINTS } from '../src/live/adapters/bitget/endpoints.ts'

test('Bitget signature prehash is deterministic and query-bound', () => {
  assert.equal(
    buildBitgetPrehash(
      '1659076670000',
      'GET',
      '/api/v2/spot/account/assets',
      'coin=USDT',
    ),
    '1659076670000GET/api/v2/spot/account/assets?coin=USDT',
  )
})

test('Bitget account permissions reject trade, transfer, and withdrawal authority', () => {
  const accepted = assertBitgetReadOnlyAuthorities({
    data: {
      userId: 'user-1',
      authorities: ['stor', 'taxr'],
    },
  })
  assert.equal(accepted.readOnly, true)

  assert.throws(() => assertBitgetReadOnlyAuthorities({
    data: {
      userId: 'user-1',
      authorities: ['stor', 'stow'],
    },
  }), (error: unknown) => {
    assert.ok(error instanceof BitgetReadOnlyClientError)
    assert.equal(error.code, 'WRITE_PERMISSION_PRESENT')
    return true
  })

  assert.throws(() => assertBitgetReadOnlyAuthorities({
    data: {
      userId: 'user-1',
      authorities: ['wwow'],
    },
  }), /forbidden write permissions/)
})

test('Bitget read-only client signs private GET requests without exposing secrets', async () => {
  let captured: RequestInit | undefined
  const client = new BitgetReadOnlyClient({
    secretProvider: {
      async read() {
        return {
          apiKey: 'test-api-key',
          secretKey: 'test-secret-key',
          passphrase: 'test-passphrase',
        }
      },
    },
    now: () => 1784289600000,
    fetcher: async (_input, init) => {
      captured = init
      return new Response(JSON.stringify({
        code: '00000',
        msg: 'success',
        data: {
          userId: 'user-1',
          authorities: ['stor', 'taxr'],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const permissions = await client.verifyReadOnlyPermissions()
  assert.equal(permissions.readOnly, true)
  assert.equal(captured?.method, 'GET')

  const headers = new Headers(captured?.headers)
  assert.equal(headers.get('ACCESS-KEY'), 'test-api-key')
  assert.equal(headers.get('ACCESS-TIMESTAMP'), '1784289600000')
  assert.equal(headers.get('ACCESS-PASSPHRASE'), 'test-passphrase')
  assert.match(headers.get('ACCESS-SIGN') ?? '', /^[A-Za-z0-9+/]+=*$/)
  assert.equal(JSON.stringify(captured).includes('test-secret-key'), false)
})

test('Bitget client rejects oversized limits and incomplete time ranges before fetch', async () => {
  let fetchCount = 0
  const client = new BitgetReadOnlyClient({
    secretProvider: {
      async read() {
        return { apiKey: 'a', secretKey: 'b', passphrase: 'c' }
      },
    },
    fetcher: async () => {
      fetchCount += 1
      return new Response('{}', { status: 200 })
    },
  })

  await assert.rejects(
    client.request(BITGET_SPOT_ENDPOINTS.historyOrders, { limit: 101 }),
    /limit must be 1-100/,
  )
  await assert.rejects(
    client.request(BITGET_SPOT_ENDPOINTS.fills, { startTime: 1 }),
    /startTime and endTime must be provided together/,
  )
  assert.equal(fetchCount, 0)
})

test('Bitget client rejects non-success API envelopes', async () => {
  const client = new BitgetReadOnlyClient({
    secretProvider: {
      async read() {
        return { apiKey: 'a', secretKey: 'b', passphrase: 'c' }
      },
    },
    now: () => 1784289600000,
    fetcher: async () => new Response(JSON.stringify({
      code: '40001',
      msg: 'permission denied',
    }), { status: 200 }),
  })

  await assert.rejects(
    client.request(BITGET_SPOT_ENDPOINTS.accountInfo),
    (error: unknown) => {
      assert.ok(error instanceof BitgetReadOnlyClientError)
      assert.equal(error.code, 'BITGET_API_ERROR')
      return true
    },
  )
})
