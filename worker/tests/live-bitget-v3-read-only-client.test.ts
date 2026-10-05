import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BitgetV3ReadOnlyClient,
  BitgetV3ReadOnlyClientError,
  assertBitgetV3ReadOnlyAuthorities,
} from '../src/live/adapters/bitget/v3/read-only-client-v3.ts'
import { BITGET_V3_ENDPOINTS } from '../src/live/adapters/bitget/v3/endpoints-v3.ts'

function testClient(fetcher: typeof fetch, now: () => number = () => 1784289600000) {
  return new BitgetV3ReadOnlyClient({
    secretProvider: {
      async read() {
        return {
          apiKey: 'test-api-key',
          secretKey: 'test-secret-key',
          passphrase: 'test-passphrase',
        }
      },
    },
    now,
    fetcher,
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UNIFIED_SETTINGS = {
  code: '00000',
  msg: 'success',
  requestTime: 1746687063471,
  data: {
    uid: '6682030769',
    accountMode: 'unified',
    accountLevel: 'basic',
    assetMode: 'multi_assets',
    holdMode: 'one_way_mode',
  },
}

test('V3 permission assertion accepts a unified account', () => {
  const accepted = assertBitgetV3ReadOnlyAuthorities(UNIFIED_SETTINGS)
  assert.equal(accepted.userId, '6682030769')
  assert.equal(accepted.accountMode, 'unified')
  assert.equal(accepted.readOnly, true)
  assert.ok(Object.isFrozen(accepted))
})

test('V3 permission assertion rejects non-unified account modes', () => {
  for (const accountMode of ['classic', 'hybrid', 'upgrading', 'switching', '']) {
    assert.throws(
      () =>
        assertBitgetV3ReadOnlyAuthorities({
          code: '00000',
          data: { uid: 'user-1', accountMode },
        }),
      (error: unknown) => {
        assert.ok(error instanceof BitgetV3ReadOnlyClientError)
        assert.equal(error.code, 'ACCOUNT_MODE_NOT_UNIFIED')
        return true
      },
    )
  }
})

test('V3 permission assertion rejects missing uid and malformed payloads', () => {
  assert.throws(
    () => assertBitgetV3ReadOnlyAuthorities({ data: { accountMode: 'unified' } }),
    (error: unknown) =>
      error instanceof BitgetV3ReadOnlyClientError && error.code === 'ACCOUNT_ID_MISSING',
  )
  for (const malformed of [null, 'x', 42, []]) {
    assert.throws(
      () => assertBitgetV3ReadOnlyAuthorities(malformed),
      (error: unknown) =>
        error instanceof BitgetV3ReadOnlyClientError &&
        error.code === 'ACCOUNT_SETTINGS_MALFORMED',
    )
  }
})

test('V3 client signs private GET requests and pins the origin', async () => {
  let capturedUrl = ''
  let captured: RequestInit | undefined
  const client = testClient(async (input, init) => {
    capturedUrl = String(input)
    captured = init
    return jsonResponse(UNIFIED_SETTINGS)
  })

  const permissions = await client.verifyReadOnlyPermissions()
  assert.equal(permissions.userId, '6682030769')
  assert.ok(capturedUrl.startsWith('https://api.bitget.com/api/v3/account/settings'))

  const headers = new Headers(captured?.headers)
  assert.equal(headers.get('ACCESS-KEY'), 'test-api-key')
  assert.equal(headers.get('ACCESS-TIMESTAMP'), '1784289600000')
  assert.equal(headers.get('ACCESS-PASSPHRASE'), 'test-passphrase')
  assert.match(headers.get('ACCESS-SIGN') ?? '', /^[A-Za-z0-9+/]+=*$/)
  assert.equal(JSON.stringify(captured).includes('test-secret-key'), false)
})

test('V3 public instruments endpoint sends no auth headers', async () => {
  let captured: RequestInit | undefined
  const client = testClient(async (_input, init) => {
    captured = init
    return jsonResponse({ code: '00000', msg: 'success', requestTime: 1, data: [] })
  })

  await client.getInstruments('SPOT')
  const headers = new Headers(captured?.headers)
  assert.equal(headers.get('ACCESS-KEY'), null)
  assert.equal(headers.get('ACCESS-SIGN'), null)
})

test('V3 client requires a category for instruments', async () => {
  const client = testClient(async () => jsonResponse({}))
  await assert.rejects(client.getInstruments('nope'), /must be one of/)
})

test('V3 client rejects non-success envelopes', async () => {
  const client = testClient(async () =>
    jsonResponse({ code: '40001', msg: 'invalid signature' }),
  )
  await assert.rejects(client.getAccountAssets(), (error: unknown) => {
    assert.ok(error instanceof BitgetV3ReadOnlyClientError)
    assert.equal(error.code, 'BITGET_V3_API_ERROR')
    return true
  })
})

test('V3 client rejects non-JSON bodies', async () => {
  const client = testClient(async () => new Response('not json', { status: 200 }))
  await assert.rejects(client.getAccountAssets(), (error: unknown) => {
    assert.ok(error instanceof BitgetV3ReadOnlyClientError)
    assert.equal(error.code, 'RESPONSE_NOT_JSON')
    return true
  })
})

test('V3 client surfaces HTTP errors', async () => {
  const client = testClient(async () => new Response('{}', { status: 429 }))
  await assert.rejects(client.getAccountAssets(), (error: unknown) => {
    assert.ok(error instanceof BitgetV3ReadOnlyClientError)
    assert.equal(error.code, 'HTTP_ERROR')
    assert.equal(error.status, 429)
    return true
  })
})

test('V3 client rejects oversized responses', async () => {
  const client = new BitgetV3ReadOnlyClient({
    secretProvider: { async read() { return { apiKey: 'a', secretKey: 'b', passphrase: 'c' } } },
    maxResponseBytes: 1024,
    fetcher: async () => new Response('x'.repeat(2048), { status: 200 }),
  })
  await assert.rejects(client.getAccountAssets(), (error: unknown) => {
    assert.ok(error instanceof BitgetV3ReadOnlyClientError)
    assert.equal(error.code, 'RESPONSE_TOO_LARGE')
    return true
  })
})

test('V3 client validates constructor bounds', () => {
  assert.throws(
    () =>
      new BitgetV3ReadOnlyClient({
        secretProvider: { async read() { return { apiKey: 'a', secretKey: 'b', passphrase: 'c' } } },
        timeoutMs: 50,
      }),
    /timeoutMs must be 100-30000/,
  )
})

test('V3 client validates funding coin codes', async () => {
  const client = testClient(async () => jsonResponse({}))
  await assert.rejects(client.getFundingAssets('!!!'), (error: unknown) => {
    assert.ok(error instanceof BitgetV3ReadOnlyClientError)
    assert.equal(error.code, 'COIN_INVALID')
    return true
  })
})

test('V3 client validates position query fields', async () => {
  const client = testClient(async () => jsonResponse({}))
  await assert.rejects(client.getCurrentPositions({ category: 'nope' }), /must be one of/)
  await assert.rejects(client.getCurrentPositions({ posSide: 'both' }), /must be long or short/)
})
