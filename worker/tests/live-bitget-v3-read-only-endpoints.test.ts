import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BITGET_V3_API_ORIGIN,
  BITGET_V3_ENDPOINTS,
  assertBitgetV3Category,
  assertBitgetV3PositionSide,
  assertBitgetV3ReadOnlyRequest,
  buildBitgetV3Query,
  isBitgetV3PrivateReadEndpoint,
  normalizeBitgetV3Symbol,
} from '../src/live/adapters/bitget/v3/endpoints-v3.ts'
import { buildBitgetPrehash } from '../src/live/adapters/bitget/read-only-client.ts'

test('V3 origin is pinned to the documented regular UTA REST domain', () => {
  assert.equal(BITGET_V3_API_ORIGIN, 'https://api.bitget.com')
})

test('V3 read-only allowlist contains exactly the five step-1 GET endpoints', () => {
  assert.deepEqual({ ...BITGET_V3_ENDPOINTS }, {
    accountAssets: '/api/v3/account/assets',
    accountSettings: '/api/v3/account/settings',
    fundingAssets: '/api/v3/account/funding-assets',
    currentPositions: '/api/v3/position/current-position',
    instruments: '/api/v3/market/instruments',
  })
  for (const path of Object.values(BITGET_V3_ENDPOINTS)) {
    assert.equal(assertBitgetV3ReadOnlyRequest('GET', path), path)
  }
})

test('V3 read-only gate rejects non-GET methods', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'post']) {
    assert.throws(
      () => assertBitgetV3ReadOnlyRequest(method, BITGET_V3_ENDPOINTS.accountAssets),
      /must use GET/,
    )
  }
})

test('V3 read-only gate rejects unknown and write paths', () => {
  for (const path of [
    '/api/v3/trade/place-order',
    '/api/v3/trade/cancel-order',
    '/api/v3/account/set-leverage',
    '/api/v2/spot/account/assets',
    '/api/v3/account/assets/extra',
  ]) {
    assert.throws(
      () => assertBitgetV3ReadOnlyRequest('GET', path),
      /not in the read-only allowlist/,
    )
  }
})

test('V3 private/public endpoint classification', () => {
  assert.equal(isBitgetV3PrivateReadEndpoint(BITGET_V3_ENDPOINTS.accountAssets), true)
  assert.equal(isBitgetV3PrivateReadEndpoint(BITGET_V3_ENDPOINTS.accountSettings), true)
  assert.equal(isBitgetV3PrivateReadEndpoint(BITGET_V3_ENDPOINTS.fundingAssets), true)
  assert.equal(isBitgetV3PrivateReadEndpoint(BITGET_V3_ENDPOINTS.currentPositions), true)
  assert.equal(isBitgetV3PrivateReadEndpoint(BITGET_V3_ENDPOINTS.instruments), false)
})

test('V3 category validation accepts documented categories only', () => {
  for (const category of ['SPOT', 'MARGIN', 'USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES']) {
    assert.equal(assertBitgetV3Category(category), category)
  }
  assert.throws(() => assertBitgetV3Category('PERP'), /must be one of/)
  assert.throws(() => assertBitgetV3Category(''), /must be one of/)
})

test('V3 position side validation', () => {
  assert.equal(assertBitgetV3PositionSide('long'), 'long')
  assert.equal(assertBitgetV3PositionSide('SHORT'), 'short')
  assert.throws(() => assertBitgetV3PositionSide('both'), /must be long or short/)
})

test('V3 symbol normalization', () => {
  assert.equal(normalizeBitgetV3Symbol('btcusdt'), 'BTCUSDT')
  assert.throws(() => normalizeBitgetV3Symbol('x'), /4-40/)
})

test('V3 query builder sorts keys and drops empties', () => {
  assert.equal(
    buildBitgetV3Query({ symbol: 'BTCUSDT', category: 'SPOT', empty: '', nil: null }),
    'category=SPOT&symbol=BTCUSDT',
  )
  assert.equal(buildBitgetV3Query({}), '')
})

test('V3 signature prehash matches the UTA docs known-answer vector', () => {
  // From Bitget UTA quick-start "GET example — Get account fee rate":
  // timestamp=16273667805456, method=GET, requestPath=/api/v3/account/fee-rate,
  // queryString=category=SPOT&symbol=BTCUSDT
  // => '16273667805456GET/api/v3/account/fee-rate?category=SPOT&symbol=BTCUSDT'
  assert.equal(
    buildBitgetPrehash(
      '16273667805456',
      'GET',
      '/api/v3/account/fee-rate',
      'category=SPOT&symbol=BTCUSDT',
    ),
    '16273667805456GET/api/v3/account/fee-rate?category=SPOT&symbol=BTCUSDT',
  )
})

test('V3 signature prehash omits the query separator when the query is empty', () => {
  assert.equal(
    buildBitgetPrehash('16273667805456', 'GET', '/api/v3/account/assets', ''),
    '16273667805456GET/api/v3/account/assets',
  )
})
