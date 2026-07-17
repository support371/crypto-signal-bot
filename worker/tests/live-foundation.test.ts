import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addDecimal,
  asDecimalString,
  compareDecimal,
  isIncrementAligned,
  multiplyDecimal,
  quantizeDown,
  subtractDecimal,
} from '../src/live/decimal.ts'
import { mutationRequestHash } from '../src/live/idempotency.ts'
import {
  normalizeProductRules,
  validateOrderAgainstProductRules,
} from '../src/live/product-rules.ts'
import { evaluatePreTradeRisk } from '../src/live/risk-engine.ts'

test('decimal arithmetic is exact and canonical', () => {
  const oneTenth = asDecimalString('0.1')
  const twoTenths = asDecimalString('0.2')

  assert.equal(addDecimal(oneTenth, twoTenths), '0.3')
  assert.equal(asDecimalString('1.2300'), '1.23')
  assert.equal(subtractDecimal(asDecimalString('1'), asDecimalString('1.25')), '-0.25')
  assert.equal(
    multiplyDecimal(asDecimalString('0.00000001'), asDecimalString('30000')),
    '0.0003',
  )
  assert.equal(compareDecimal(asDecimalString('10.00'), asDecimalString('10')), 0)
})

test('exchange increments are enforced without floating point rounding', () => {
  const increment = asDecimalString('0.001')

  assert.equal(quantizeDown(asDecimalString('1.234567'), increment), '1.234')
  assert.equal(isIncrementAligned(asDecimalString('1.234'), increment), true)
  assert.equal(isIncrementAligned(asDecimalString('1.2345'), increment), false)
})

test('invalid decimal inputs fail closed', () => {
  assert.throws(() => asDecimalString('-1'), /non-negative/)
  assert.throws(() => asDecimalString('01.2'), /non-negative/)
  assert.throws(() => asDecimalString('1e-8'), /non-negative/)
  assert.throws(() => quantizeDown(asDecimalString('1'), asDecimalString('0')), /greater than zero/)
})

test('idempotency request hashes are canonical and identity-bound', async () => {
  const base = {
    operationScope: 'orders.create',
    idempotencyKey: 'order:2026:0001',
    exchangeAccountId: 'account-ref-hash',
    actorId: 'operator-123',
    expiresAt: null,
  }

  const first = await mutationRequestHash({
    ...base,
    payload: { side: 'BUY', productId: 'BTC-USD', size: '0.01' },
  })
  const reordered = await mutationRequestHash({
    ...base,
    payload: { size: '0.01', productId: 'BTC-USD', side: 'BUY' },
  })
  const otherActor = await mutationRequestHash({
    ...base,
    actorId: 'operator-456',
    payload: { side: 'BUY', productId: 'BTC-USD', size: '0.01' },
  })

  assert.equal(first, reordered)
  assert.notEqual(first, otherActor)
  assert.match(first, /^[a-f0-9]{64}$/)
})

test('product rules accept only fresh, aligned, supported orders', () => {
  const now = new Date('2026-07-17T10:00:00.000Z')
  const rules = normalizeProductRules({
    productId: 'btc-usd',
    baseAsset: 'btc',
    quoteAsset: 'usd',
    baseIncrement: '0.00000001',
    quoteIncrement: '0.01',
    priceIncrement: '0.01',
    minimumBaseSize: '0.0001',
    maximumBaseSize: '10',
    minimumQuoteSize: '5',
    tradingEnabled: true,
    supportedOrderTypes: ['market', 'limit'],
    observedAt: '2026-07-17T09:59:00.000Z',
    expiresAt: '2026-07-17T10:05:00.000Z',
  })

  const accepted = validateOrderAgainstProductRules({
    intentId: 'intent-1',
    idempotencyKey: 'order:2026:0002',
    correlationId: 'correlation-1',
    exchangeAccountId: 'account-ref-hash',
    productId: 'BTC-USD',
    side: 'BUY',
    orderType: 'MARKET',
    baseQuantity: null,
    quoteNotional: asDecimalString('25.00'),
    limitPrice: null,
    stopPrice: null,
    strategyId: null,
    requestedBy: 'operator-123',
    requestedAt: now.toISOString(),
  }, rules, now)

  assert.equal(accepted.accepted, true)
  assert.deepEqual(accepted.reasons, [])

  const rejected = validateOrderAgainstProductRules({
    intentId: 'intent-2',
    idempotencyKey: 'order:2026:0003',
    correlationId: 'correlation-2',
    exchangeAccountId: 'account-ref-hash',
    productId: 'BTC-USD',
    side: 'BUY',
    orderType: 'LIMIT',
    baseQuantity: asDecimalString('0.000100005'),
    quoteNotional: null,
    limitPrice: asDecimalString('100000.001'),
    stopPrice: null,
    strategyId: null,
    requestedBy: 'operator-123',
    requestedAt: now.toISOString(),
  }, rules, now)

  assert.equal(rejected.accepted, false)
  assert.ok(rejected.reasons.includes('base_quantity_increment_mismatch'))
  assert.ok(rejected.reasons.includes('limit_price_increment_mismatch'))
})

test('stale product rules block an otherwise valid order', () => {
  const rules = normalizeProductRules({
    productId: 'BTC-USD',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    baseIncrement: '0.00000001',
    quoteIncrement: '0.01',
    priceIncrement: '0.01',
    minimumBaseSize: '0.0001',
    maximumBaseSize: '10',
    minimumQuoteSize: '5',
    tradingEnabled: true,
    supportedOrderTypes: ['MARKET'],
    observedAt: '2026-07-17T09:00:00.000Z',
    expiresAt: '2026-07-17T09:05:00.000Z',
  })

  const result = validateOrderAgainstProductRules({
    intentId: 'intent-3',
    idempotencyKey: 'order:2026:0004',
    correlationId: 'correlation-3',
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
    requestedAt: '2026-07-17T10:00:00.000Z',
  }, rules, new Date('2026-07-17T10:00:00.000Z'))

  assert.equal(result.accepted, false)
  assert.ok(result.reasons.includes('product_rules_stale'))
})

test('pre-trade risk approves only when every mandatory gate passes', () => {
  const base = {
    decisionId: 'risk-1',
    configurationVersion: 'config-v1',
    decidedAt: '2026-07-17T10:00:00.000Z',
    side: 'BUY' as const,
    orderNotional: asDecimalString('100'),
    baseQuantity: asDecimalString('0.001'),
    dailyTradedNotional: asDecimalString('250'),
    currentPositionNotional: asDecimalString('500'),
    availableQuoteBalance: asDecimalString('1000'),
    availableBaseBalance: asDecimalString('1'),
    openOrderCount: 1,
    accountEligible: true,
    releaseActive: true,
    guardianClear: true,
    executionUnlocked: true,
    marketFeedFresh: true,
    productRulesFresh: true,
    reconciliationClear: true,
    idempotencyClaimed: true,
    limits: {
      maxOrderNotional: asDecimalString('200'),
      maxDailyNotional: asDecimalString('1000'),
      maxPositionNotional: asDecimalString('1000'),
      maxOpenOrders: 5,
    },
  }

  const approved = evaluatePreTradeRisk(base)
  assert.equal(approved.approved, true)
  assert.ok(approved.rules.every((result) => result.passed))

  const locked = evaluatePreTradeRisk({
    ...base,
    decisionId: 'risk-2',
    executionUnlocked: false,
  })
  assert.equal(locked.approved, false)
  assert.equal(
    locked.rules.find((result) => result.rule === 'execution_unlocked')?.reason,
    'execution_locked',
  )

  const overLimit = evaluatePreTradeRisk({
    ...base,
    decisionId: 'risk-3',
    orderNotional: asDecimalString('300'),
  })
  assert.equal(overLimit.approved, false)
  assert.equal(
    overLimit.rules.find((result) => result.rule === 'order_notional_limit')?.reason,
    'order_notional_exceeds_limit',
  )
})
