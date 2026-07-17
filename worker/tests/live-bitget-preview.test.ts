import assert from 'node:assert/strict'
import test from 'node:test'

import type { OrderPreviewRequest } from '../src/live/exchange-contracts.ts'
import type { ProductRules } from '../src/live/domain.ts'
import {
  asDecimalString,
  divideDecimalDown,
} from '../src/live/decimal.ts'
import {
  BitgetLockedPreviewAdapter,
  previewBitgetOrderLocked,
  type BitgetLockedPreviewOptions,
} from '../src/live/adapters/bitget/preview.ts'

function rules(): ProductRules {
  return {
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    baseIncrement: asDecimalString('0.00000001'),
    quoteIncrement: asDecimalString('0.01'),
    priceIncrement: asDecimalString('0.01'),
    minimumBaseSize: asDecimalString('0.0001'),
    maximumBaseSize: asDecimalString('10'),
    minimumQuoteSize: asDecimalString('5'),
    tradingEnabled: true,
    supportedOrderTypes: ['MARKET', 'LIMIT'],
    observedAt: '2026-07-17T14:00:00.000Z',
    expiresAt: '2026-07-17T14:10:00.000Z',
  }
}

function options(overrides: Partial<BitgetLockedPreviewOptions> = {}): BitgetLockedPreviewOptions {
  return {
    productRules: rules(),
    referencePrice: {
      productId: 'BTC-USDT',
      price: asDecimalString('50000'),
      observedAt: '2026-07-17T14:04:00.000Z',
      expiresAt: '2026-07-17T14:06:00.000Z',
    },
    feeRate: asDecimalString('0.001'),
    slippageBps: 100,
    now: () => new Date('2026-07-17T14:05:00.000Z'),
    ...overrides,
  }
}

function marketBuy(): OrderPreviewRequest {
  return {
    productId: 'BTC-USDT',
    side: 'BUY',
    orderType: 'MARKET',
    baseQuantity: null,
    quoteNotional: asDecimalString('100'),
    limitPrice: null,
    stopPrice: null,
  }
}

test('exact division rounds down at an explicit scale', () => {
  assert.equal(
    divideDecimalDown(asDecimalString('1'), asDecimalString('3'), 6),
    '0.333333',
  )
  assert.equal(
    divideDecimalDown(asDecimalString('10'), asDecimalString('4'), 8),
    '2.5',
  )
  assert.throws(
    () => divideDecimalDown(asDecimalString('1'), asDecimalString('0'), 8),
    /divisor must be greater than zero/,
  )
  assert.throws(
    () => divideDecimalDown(asDecimalString('1'), asDecimalString('2'), 37),
    /division scale must be an integer from 0 to 36/,
  )
})

test('Bitget market-buy preview remains quote-sized and exact', async () => {
  const preview = await previewBitgetOrderLocked(options(), marketBuy())

  assert.equal(preview.accepted, true)
  assert.equal(preview.executionAllowed, false)
  assert.equal(preview.previewSource, 'LOCAL_LOCKED_ESTIMATE')
  assert.equal(preview.estimatedFillPrice, '50500')
  assert.equal(preview.estimatedBaseQuantity, '0.00198019')
  assert.equal(preview.estimatedQuoteValue, '100')
  assert.equal(preview.estimatedFees, '0.1')
  assert.equal(preview.estimatedTotalDebit, '100.1')
  assert.equal(preview.estimatedNetCredit, null)
  assert.equal(preview.estimatedTotal, '100.1')
  assert.match(preview.rawResponseHash, /^[a-f0-9]{64}$/)
  assert.match(preview.previewId ?? '', /^bitget-local-[a-f0-9]{24}$/)
  assert.ok(preview.warnings.includes('execution_locked'))
})

test('Bitget sell preview calculates conservative net quote proceeds', async () => {
  const preview = await previewBitgetOrderLocked(options(), {
    productId: 'BTC-USDT',
    side: 'SELL',
    orderType: 'MARKET',
    baseQuantity: asDecimalString('0.01'),
    quoteNotional: null,
    limitPrice: null,
    stopPrice: null,
  })

  assert.equal(preview.accepted, true)
  assert.equal(preview.estimatedFillPrice, '49500')
  assert.equal(preview.estimatedBaseQuantity, '0.01')
  assert.equal(preview.estimatedQuoteValue, '495')
  assert.equal(preview.estimatedFees, '0.495')
  assert.equal(preview.estimatedTotalDebit, null)
  assert.equal(preview.estimatedNetCredit, '494.505')
  assert.equal(preview.estimatedTotal, '494.505')
})

test('locked preview hash is deterministic for identical evidence', async () => {
  const first = await previewBitgetOrderLocked(options(), marketBuy())
  const second = await previewBitgetOrderLocked(options(), marketBuy())
  assert.equal(first.rawResponseHash, second.rawResponseHash)
  assert.equal(first.previewId, second.previewId)
})

test('stale reference price blocks preview', async () => {
  const preview = await previewBitgetOrderLocked(options({
    referencePrice: {
      productId: 'BTC-USDT',
      price: asDecimalString('50000'),
      observedAt: '2026-07-17T13:00:00.000Z',
      expiresAt: '2026-07-17T13:01:00.000Z',
    },
  }), marketBuy())

  assert.equal(preview.accepted, false)
  assert.equal(preview.executionAllowed, false)
  assert.ok(preview.errors.includes('reference_price_stale'))
  assert.equal(preview.estimatedTotal, null)
})

test('Bitget provider sizing rules reject base-sized market buys', async () => {
  const preview = await previewBitgetOrderLocked(options(), {
    ...marketBuy(),
    baseQuantity: asDecimalString('0.001'),
    quoteNotional: null,
  })

  assert.equal(preview.accepted, false)
  assert.ok(preview.errors.includes('bitget_market_buy_requires_quote_notional'))
})

test('preview adapter permanently rejects every mutation operation', () => {
  const adapter = new BitgetLockedPreviewAdapter(options())
  assert.throws(() => adapter.createOrder(), /execution-locked/)
  assert.throws(() => adapter.cancelOrder(), /execution-locked/)
  assert.throws(() => adapter.replaceOrder(), /execution-locked/)
  assert.throws(() => adapter.requestWithdrawal(), /execution-locked/)
})
