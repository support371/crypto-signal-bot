import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_EXECUTION_EXCHANGE_ORDER,
  EXCHANGE_PROVIDERS,
  normalizeExecutionExchange,
  resolveExecutionExchangeOrder,
} from '../src/live/exchange-registry.ts'
import {
  BtccApiManifestUnavailable,
  validateBtccReadOnlyManifest,
} from '../src/live/adapters/btcc/contract.ts'
import { BitgetReadOnlyAdapter } from '../src/live/adapters/bitget/normalizer.ts'

test('BTCC and Bitget are the only default execution exchanges', () => {
  assert.deepEqual(DEFAULT_EXECUTION_EXCHANGE_ORDER, ['BTCC', 'BITGET'])
  assert.deepEqual(resolveExecutionExchangeOrder(), ['BTCC', 'BITGET'])
  assert.equal(EXCHANGE_PROVIDERS.BTCC.executionPriority, 1)
  assert.equal(EXCHANGE_PROVIDERS.BITGET.executionPriority, 2)
  assert.equal(EXCHANGE_PROVIDERS.COINBASE.marketDataOnly, true)
  assert.equal(EXCHANGE_PROVIDERS.COINBASE.executionDefault, false)
  assert.throws(() => normalizeExecutionExchange('coinbase'), /Unsupported execution exchange/)
})

test('legacy bitgate spelling canonicalizes to Bitget', () => {
  assert.equal(normalizeExecutionExchange('bitgate'), 'BITGET')
  assert.deepEqual(resolveExecutionExchangeOrder('btcc', 'bitgate'), ['BTCC', 'BITGET'])
})

test('BTCC remains fail-closed until an official read-only endpoint manifest is imported', () => {
  assert.throws(() => validateBtccReadOnlyManifest(null), BtccApiManifestUnavailable)
  assert.throws(() => validateBtccReadOnlyManifest({
    officialGuideRevision: '2025-11-18',
    restOrigin: 'https://api.example.invalid',
    manifestSha256: 'a'.repeat(64),
    endpoints: [{ name: 'placeOrder', method: 'GET', path: '/orders/place' }],
  }), /not read-only/)

  const manifest = validateBtccReadOnlyManifest({
    officialGuideRevision: '2025-11-18',
    restOrigin: 'https://api.example.invalid',
    manifestSha256: 'a'.repeat(64),
    endpoints: [{ name: 'accountHistory', method: 'GET', path: '/account/history' }],
  })
  assert.equal(manifest.endpoints[0]?.method, 'GET')
})

test('Bitget product metadata preserves exact increments and minimums', () => {
  const adapter = new BitgetReadOnlyAdapter()
  const product = adapter.normalizeProduct({
    symbol: 'BTCUSDT',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    minTradeAmount: '0.0001',
    maxTradeAmount: '100',
    minTradeUSDT: '5',
    pricePrecision: '2',
    quantityPrecision: '6',
    quotePrecision: '2',
    status: 'online',
    lastPr: '65000.25',
  }, '2026-07-17T12:00:00.000Z', '2026-07-17T12:05:00.000Z')

  assert.equal(product.productId, 'BTC-USDT')
  assert.equal(product.rules.baseIncrement, '0.000001')
  assert.equal(product.rules.quoteIncrement, '0.01')
  assert.equal(product.rules.priceIncrement, '0.01')
  assert.equal(product.rules.minimumBaseSize, '0.0001')
  assert.equal(product.rules.minimumQuoteSize, '5')
  assert.deepEqual(product.rules.supportedOrderTypes, ['MARKET', 'LIMIT'])
})

test('Bitget account held balance includes frozen and locked assets', () => {
  const adapter = new BitgetReadOnlyAdapter()
  const balance = adapter.normalizeAccount({
    coin: 'usdt',
    available: '100.25',
    frozen: '2.5',
    locked: '1.25',
    uTime: '1784289600000',
  }, '2026-07-17T12:00:00.000Z')

  assert.equal(balance.asset, 'USDT')
  assert.equal(balance.available, '100.25')
  assert.equal(balance.held, '3.75')
})

test('Bitget market buy is quote-sized and never invents a requested base quantity', () => {
  const adapter = new BitgetReadOnlyAdapter()
  const order = adapter.normalizeOrder({
    symbol: 'BTCUSDT',
    orderId: 'exchange-order-1',
    clientOid: 'client-order-1',
    size: '25',
    orderType: 'market',
    side: 'buy',
    status: 'filled',
    priceAvg: '62000',
    baseVolume: '0.0004',
    quoteVolume: '24.8',
    feeDetail: {
      feeCoin: 'BTC',
      totalFee: '-0.0000004',
    },
    cTime: '1784289600000',
    uTime: '1784289601000',
  })

  assert.equal(order.requestedBaseQuantity, null)
  assert.equal(order.requestedQuoteNotional, '25')
  assert.equal(order.filledBaseQuantity, '0.0004')
  assert.equal(order.totalFees, '0.0000004')
  assert.equal(order.settled, true)
})

test('Bitget fill normalization preserves fee asset and exact decimal strings', () => {
  const adapter = new BitgetReadOnlyAdapter()
  const fill = adapter.normalizeFill({
    symbol: 'BTCUSDT',
    orderId: 'exchange-order-1',
    tradeId: 'trade-1',
    side: 'buy',
    priceAvg: '62000',
    size: '0.0004',
    feeDetail: {
      feeCoin: 'BTC',
      totalFee: '-0.0000004',
    },
    cTime: '1784289600000',
    uTime: '1784289601000',
  })

  assert.equal(fill.productId, 'BTC-USDT')
  assert.equal(fill.price, '62000')
  assert.equal(fill.baseSize, '0.0004')
  assert.equal(fill.commission, '0.0000004')
  assert.equal(fill.commissionAsset, 'BTC')
})
