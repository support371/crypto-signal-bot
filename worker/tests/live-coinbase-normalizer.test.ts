import assert from 'node:assert/strict'
import test from 'node:test'

import { CoinbaseReadOnlyNormalizer } from '../src/live/adapters/coinbase/normalizer.ts'
import {
  coinbaseOrderPath,
  coinbaseProductPath,
  COINBASE_ENDPOINTS,
  COINBASE_USER_WS_URL,
} from '../src/live/adapters/coinbase/endpoints.ts'
import { validateOrderAgainstProductRules } from '../src/live/product-rules.ts'
import { asDecimalString } from '../src/live/decimal.ts'

const observedAt = '2026-07-17T10:00:00.000Z'
const expiresAt = '2026-07-17T10:05:00.000Z'
const normalizer = new CoinbaseReadOnlyNormalizer(observedAt)

test('Coinbase capability report distinguishes provider support from candidate activation', () => {
  assert.equal(normalizer.capabilities.exchange, 'coinbase-advanced-trade')
  assert.equal(normalizer.capabilities.orderPreview, true)
  assert.equal(normalizer.capabilities.createOrder, true)
  assert.equal(normalizer.capabilities.userStream, true)
  assert.equal(normalizer.capabilities.candidateExecutionEnabled, false)
  assert.equal(normalizer.capabilities.candidateWithdrawalsEnabled, false)
})

test('Coinbase account balances preserve exact available and held amounts', () => {
  const account = normalizer.normalizeAccount({
    account: {
      uuid: 'account-1',
      currency: 'BTC',
      available_balance: { value: '1.23000000', currency: 'BTC' },
      hold: { value: '0.01000000', currency: 'BTC' },
      active: true,
      ready: true,
    },
  }, observedAt)

  assert.deepEqual(account, {
    accountId: 'account-1',
    asset: 'BTC',
    available: '1.23',
    held: '0.01',
    active: true,
    ready: true,
    observedAt,
  })
})

test('Coinbase products normalize exact increments and trading rules', () => {
  const product = normalizer.normalizeProduct({
    product: {
      product_id: 'BTC-USD',
      price: '100000.25',
      base_increment: '0.00000001',
      quote_increment: '0.01',
      price_increment: '0.01',
      quote_min_size: '5.00',
      base_min_size: '0.0001',
      base_max_size: '10',
      is_disabled: false,
      trading_disabled: false,
      cancel_only: false,
      limit_only: false,
      post_only: false,
      status: 'online',
    },
  }, observedAt, expiresAt)

  assert.equal(product.productId, 'BTC-USD')
  assert.equal(product.price, '100000.25')
  assert.deepEqual(product.rules.supportedOrderTypes, ['MARKET', 'LIMIT'])
  assert.equal(product.rules.baseIncrement, '0.00000001')
  assert.equal(product.rules.minimumQuoteSize, '5')
})

test('disabled Coinbase products normalize but reject every order', () => {
  const product = normalizer.normalizeProduct({
    product_id: 'BTC-USD',
    price: '100000',
    base_increment: '0.00000001',
    quote_increment: '0.01',
    quote_min_size: '5',
    base_min_size: '0.0001',
    base_max_size: '10',
    is_disabled: true,
    trading_disabled: true,
    status: 'offline',
  }, observedAt, expiresAt)

  assert.deepEqual(product.rules.supportedOrderTypes, [])
  const result = validateOrderAgainstProductRules({
    intentId: 'intent-disabled-1',
    idempotencyKey: 'order:disabled:0001',
    correlationId: 'correlation-disabled-1',
    exchangeAccountId: 'account-ref-hash',
    productId: 'BTC-USD',
    side: 'BUY',
    orderType: 'MARKET',
    baseQuantity: null,
    quoteNotional: asDecimalString('25'),
    limitPrice: null,
    stopPrice: null,
    strategyId: null,
    requestedBy: 'operator-123',
    requestedAt: observedAt,
  }, product.rules, new Date(observedAt))

  assert.equal(result.accepted, false)
  assert.ok(result.reasons.includes('product_trading_disabled'))
  assert.ok(result.reasons.includes('order_type_not_supported'))
})

test('quote-sized Coinbase market orders never invent a requested base quantity', () => {
  const order = normalizer.normalizeOrder({
    order: {
      order_id: 'exchange-order-1',
      product_id: 'BTC-USD',
      side: 'BUY',
      client_order_id: 'client-order-1',
      status: 'PENDING',
      created_time: '2026-07-17T10:00:00.000Z',
      last_update_time: '2026-07-17T10:00:01.000Z',
      order_type: 'MARKET',
      order_configuration: {
        market_market_ioc: {
          quote_size: '100.00',
          rfq_disabled: true,
        },
      },
      filled_size: '0.0005',
      filled_value: '50.00',
      average_filled_price: '100000.00',
      total_fees: '0.20',
      pending_cancel: false,
      settled: false,
    },
  })

  assert.equal(order.requestedBaseQuantity, null)
  assert.equal(order.requestedQuoteNotional, '100')
  assert.equal(order.filledBaseQuantity, '0.0005')
  assert.equal(order.remainingBaseQuantity, null)
})

test('base-sized Coinbase orders calculate exact remaining quantity', () => {
  const order = normalizer.normalizeOrder({
    order_id: 'exchange-order-2',
    product_id: 'BTC-USD',
    side: 'SELL',
    client_order_id: 'client-order-2',
    status: 'OPEN',
    created_time: '2026-07-17T10:00:00.000Z',
    order_type: 'LIMIT',
    order_configuration: {
      limit_limit_gtc: {
        base_size: '0.01000000',
        limit_price: '105000.00',
        post_only: false,
      },
    },
    filled_size: '0.00300000',
    filled_value: '315.00',
    average_filled_price: '105000.00',
    total_fees: '0.50',
    pending_cancel: false,
    settled: false,
  })

  assert.equal(order.requestedBaseQuantity, '0.01')
  assert.equal(order.filledBaseQuantity, '0.003')
  assert.equal(order.remainingBaseQuantity, '0.007')
})

test('Coinbase fills normalize exact price, size, commission, and timestamps', () => {
  const fill = normalizer.normalizeFill({
    fill: {
      entry_id: 'fill-entry-1',
      trade_id: 'trade-1',
      order_id: 'exchange-order-2',
      product_id: 'BTC-USD',
      side: 'SELL',
      price: '105000.00',
      size: '0.00300000',
      commission: '0.50',
      commission_currency: 'USD',
      trade_time: '2026-07-17T10:00:02.000Z',
      sequence_timestamp: '2026-07-17T10:00:02.100Z',
    },
  })

  assert.equal(fill.price, '105000')
  assert.equal(fill.baseSize, '0.003')
  assert.equal(fill.commission, '0.5')
  assert.equal(fill.commissionAsset, 'USD')
})

test('Coinbase endpoint builders validate path identifiers', () => {
  assert.equal(COINBASE_ENDPOINTS.orderPreview, '/api/v3/brokerage/orders/preview')
  assert.equal(COINBASE_USER_WS_URL, 'wss://advanced-trade-ws-user.coinbase.com')
  assert.equal(coinbaseProductPath('btc-usd'), '/api/v3/brokerage/products/BTC-USD')
  assert.equal(
    coinbaseProductPath('btc-usd', true),
    '/api/v3/brokerage/market/products/BTC-USD',
  )
  assert.equal(
    coinbaseOrderPath('exchange-order-1'),
    '/api/v3/brokerage/orders/historical/exchange-order-1',
  )
  assert.throws(() => coinbaseProductPath('BTCUSD'), /BASE-QUOTE/)
  assert.throws(() => coinbaseOrderPath('../order'), /path-safe/)
})
