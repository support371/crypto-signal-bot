import assert from 'node:assert/strict'
import test from 'node:test'

import {
  certifyBitgetReadOnlyContracts,
  type BitgetReadOnlyCertificationClient,
  type BitgetReadOnlyCertificationInput,
} from '../src/live/bitget-read-only-certification.ts'
import {
  BITGET_SPOT_ENDPOINTS,
  type BitgetReadOnlyEndpoint,
} from '../src/live/adapters/bitget/endpoints.ts'
import { BitgetReadOnlyClientError } from '../src/live/adapters/bitget/read-only-client.ts'

function productRow() {
  return {
    symbol: 'BTCUSDT',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    status: 'online',
    quantityPrecision: '8',
    quotePrecision: '2',
    pricePrecision: '2',
    minTradeAmount: '0.0001',
    maxTradeAmount: '10',
    minTradeUSDT: '5',
    lastPr: '50000',
  }
}

function balanceRow(coin: string, available: string) {
  return {
    coin,
    available,
    frozen: '0',
    locked: '0',
    uTime: '1784336400000',
  }
}

function orderRow(
  orderId: string,
  status: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    orderId,
    clientOid: `client-${orderId}`,
    symbol: 'BTCUSDT',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    baseVolume: status === 'filled' ? '0.01' : '0.005',
    quoteVolume: status === 'filled' ? '500' : '250',
    priceAvg: '50000',
    feeDetail: JSON.stringify({ totalFee: '-0.5', feeCoin: 'USDT' }),
    status,
    cTime: '1784336400000',
    uTime: updatedAt,
    ...overrides,
  }
}

function fillRow(fillId: string, orderId: string, updatedAt = '1784336460000') {
  return {
    tradeId: fillId,
    orderId,
    symbol: 'BTCUSDT',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    side: 'buy',
    priceAvg: '50000',
    size: '0.005',
    feeDetail: JSON.stringify({ totalFee: '-0.25', feeCoin: 'USDT' }),
    cTime: '1784336459000',
    uTime: updatedAt,
  }
}

class FixtureClient implements BitgetReadOnlyCertificationClient {
  permissions = {
    userId: 'bitget-user-fixture',
    authorities: Object.freeze(['readonly']),
    readOnly: true,
  }
  products: unknown = { code: '00000', data: [productRow()] }
  balances: unknown = {
    code: '00000',
    data: [balanceRow('BTC', '1'), balanceRow('USDT', '1000')],
  }
  currentOrders: unknown = {
    code: '00000',
    data: { orderList: [orderRow('order-current', 'live', '1784336460000')] },
  }
  historyOrders: unknown = {
    code: '00000',
    data: { orderList: [orderRow('order-history', 'filled', '1784336470000')] },
  }
  fills: unknown = {
    code: '00000',
    data: { fillList: [fillRow('fill-1', 'order-history')] },
  }
  privateCalls = 0

  async verifyReadOnlyPermissions() {
    this.privateCalls += 1
    return this.permissions
  }

  async request(endpoint: BitgetReadOnlyEndpoint): Promise<unknown> {
    assert.equal(endpoint, BITGET_SPOT_ENDPOINTS.symbols)
    return this.products
  }

  async listAccountAssets(): Promise<unknown> {
    this.privateCalls += 1
    return this.balances
  }

  async listCurrentOrders(): Promise<unknown> {
    this.privateCalls += 1
    return this.currentOrders
  }

  async listHistoryOrders(): Promise<unknown> {
    this.privateCalls += 1
    return this.historyOrders
  }

  async listFills(): Promise<unknown> {
    this.privateCalls += 1
    return this.fills
  }
}

function input(client: BitgetReadOnlyCertificationClient): BitgetReadOnlyCertificationInput {
  return {
    runId: 'bitget-read-cert-1',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    windowStartMs: 1784332800000,
    windowEndMs: 1784336460000,
    observedAt: '2026-07-18T00:59:00.000Z',
    productExpiresAt: '2026-07-18T01:05:00.000Z',
    evaluatedAt: '2026-07-18T01:00:00.000Z',
    client,
  }
}

test('credential-free fixture run certifies read-only contracts without live authority', async () => {
  const client = new FixtureClient()
  const result = await certifyBitgetReadOnlyContracts(input(client))

  assert.equal(result.status, 'PASSED')
  assert.equal(result.readOnlyEvidenceComplete, true)
  assert.equal(result.permissionsVerified, true)
  assert.equal(result.productCount, 1)
  assert.equal(result.balanceCount, 2)
  assert.equal(result.currentOrderCount, 1)
  assert.equal(result.historyOrderCount, 1)
  assert.equal(result.fillCount, 1)
  assert.equal(result.duplicateOrderCount, 0)
  assert.equal(result.duplicateFillCount, 0)
  assert.equal(result.checks.every((check) => check.status === 'PASS'), true)
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/)
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
  assert.equal(result.transferAllowed, false)
  assert.equal(result.withdrawalAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(result.credentialsPersisted, false)
  assert.equal(client.privateCalls, 5)
})

test('certification evidence is deterministic for identical normalized fixtures', async () => {
  const first = await certifyBitgetReadOnlyContracts(input(new FixtureClient()))
  const second = await certifyBitgetReadOnlyContracts(input(new FixtureClient()))
  assert.equal(first.evidenceHash, second.evidenceHash)
  assert.deepEqual(first.checks, second.checks)
})

test('write-capable authority fails closed before account data collection', async () => {
  class WriteClient extends FixtureClient {
    override async verifyReadOnlyPermissions() {
      this.privateCalls += 1
      throw new BitgetReadOnlyClientError(
        'WRITE_PERMISSION_PRESENT',
        'Bitget key has forbidden write permissions: spot-write',
      )
    }
  }
  const client = new WriteClient()
  await assert.rejects(
    certifyBitgetReadOnlyContracts(input(client)),
    /forbidden write permissions/,
  )
  assert.equal(client.privateCalls, 1)
})

test('malformed product contract returns failed non-live evidence', async () => {
  const client = new FixtureClient()
  client.products = { code: '00000', data: [{ ...productRow(), pricePrecision: 'invalid' }] }
  const result = await certifyBitgetReadOnlyContracts(input(client))
  assert.equal(result.status, 'FAILED')
  assert.equal(result.readOnlyEvidenceComplete, false)
  const productCheck = result.checks.find((check) => check.name === 'PRODUCT_CONTRACT')
  assert.equal(productCheck?.status, 'FAIL')
  assert.equal(productCheck?.reason, 'product_contract_normalization_failed')
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.executionAllowed, false)
})

test('a saturated page blocks certification until continuation evidence exists', async () => {
  const client = new FixtureClient()
  client.currentOrders = {
    code: '00000',
    data: {
      orderList: Array.from({ length: 100 }, (_, index) => orderRow(
        `order-${String(index).padStart(3, '0')}`,
        'live',
        String(1784336460000 + index),
      )),
    },
  }
  const result = await certifyBitgetReadOnlyContracts(input(client))
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.readOnlyEvidenceComplete, false)
  const pagination = result.checks.find((check) => check.name === 'PAGINATION_BOUNDARY')
  assert.equal(pagination?.status, 'BLOCKED')
  assert.equal(pagination?.reason, 'saturated_page_requires_continuation_evidence')
})

test('conflicting order identity evidence fails recovery consistency', async () => {
  const client = new FixtureClient()
  client.currentOrders = {
    code: '00000',
    data: { orderList: [orderRow('shared-order', 'live', '1784336460000')] },
  }
  client.historyOrders = {
    code: '00000',
    data: { orderList: [orderRow('shared-order', 'filled', '1784336470000')] },
  }
  const result = await certifyBitgetReadOnlyContracts(input(client))
  assert.equal(result.status, 'FAILED')
  const consistency = result.checks.find((check) => check.name === 'RECOVERY_IDENTITY_CONSISTENCY')
  assert.equal(consistency?.status, 'FAIL')
  assert.equal(consistency?.reason, 'conflicting_provider_identity_evidence')
})

test('invalid time windows and product scope fail before client calls', async () => {
  const client = new FixtureClient()
  await assert.rejects(
    certifyBitgetReadOnlyContracts({
      ...input(client),
      windowEndMs: 1784332800000,
    }),
    /query window must use increasing safe Unix milliseconds/,
  )
  await assert.rejects(
    certifyBitgetReadOnlyContracts({
      ...input(client),
      productId: 'ETH-USDT',
    }),
    /productId does not match baseAsset and quoteAsset/,
  )
  assert.equal(client.privateCalls, 0)
})
