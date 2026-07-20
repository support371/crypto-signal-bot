import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import {
  BitgetDemoCertificationCompositionError,
  runComposedBitgetDemoPlaceCertification,
  type BitgetDemoCertificationCompositionDependencies,
} from '../src/live/adapters/bitget/demo-certification-composition.ts'
import {
  buildBitgetCancelOrderCandidate,
  buildBitgetPlaceOrderCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const BUILT_AT = '2026-07-19T10:00:00.000Z'
const EXPIRES_AT = '2026-07-19T10:02:00.000Z'

function productRules(): ProductRules {
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
    observedAt: '2026-07-19T09:59:00.000Z',
    expiresAt: EXPIRES_AT,
  }
}

function dependencies(overrides: Partial<BitgetDemoCertificationCompositionDependencies<string>> = {}) {
  const events: string[] = []
  const value: BitgetDemoCertificationCompositionDependencies<string> = {
    serializer: {
      async run<T>(_accountId: string, operation: () => Promise<T>): Promise<T> {
        events.push('serializer')
        return operation()
      },
    },
    credentialLeaseSource: {
      async withLease<T>(_accountId, use): Promise<T> {
        events.push('credential')
        return use(Object.freeze({ apiKey: 'demo', secretKey: 'demo', passphrase: 'demo' }))
      },
    },
    rateLimitNamespace: {
      idFromName(name) {
        events.push(`rate-id:${name}`)
        return name
      },
      get() {
        return {
          async fetch() {
            events.push('rate-fetch')
            return new Response('{}', { status: 409 })
          },
        }
      },
    },
    recoveryLookupSource: {
      async lookup() {
        events.push('recovery')
        throw new Error('not expected')
      },
    },
    fetcher: async () => {
      events.push('fetch')
      throw new Error('not expected')
    },
    clock: {
      now: () => new Date('2026-07-19T10:00:30.000Z'),
    },
    ...overrides,
  }
  return { value, events }
}

function envThatMustNotBeRead(): { DB: D1Database } {
  return {
    DB: {
      prepare() {
        throw new Error('D1 must not be read for a rejected composition')
      },
    } as unknown as D1Database,
  }
}

const controlBinding = Object.freeze({
  bindingId: 'demo-control-binding-0001',
  assessmentId: 'assessment-demo-place-0001',
  idempotencyOperationId: 'idempotency-operation-0001',
  guardianScopes: Object.freeze([
    { scopeType: 'GLOBAL' as const, scopeKey: 'global' },
    { scopeType: 'ENVIRONMENT' as const, scopeKey: 'BITGET_DEMO' },
    { scopeType: 'EXCHANGE' as const, scopeKey: 'BITGET' },
    { scopeType: 'ACCOUNT' as const, scopeKey: 'bitget-demo-account-0001' },
    { scopeType: 'SYMBOL' as const, scopeKey: 'BTCUSDT' },
    { scopeType: 'ORDER_TYPE' as const, scopeKey: 'MARKET' },
  ]),
})

test('composition rejects cancel candidates before D1, credentials, rate authority, recovery or fetch', async () => {
  const cancel = await buildBitgetCancelOrderCandidate({
    productId: 'BTC-USDT',
    identity: { orderId: 'demo-order-0001', clientOrderId: null },
    builtAt: BUILT_AT,
    expiresAt: EXPIRES_AT,
  })
  const injected = dependencies()
  await assert.rejects(
    runComposedBitgetDemoPlaceCertification(
      envThatMustNotBeRead(),
      {
        authorizationId: 'demo-authorization-0001',
        dispatchAttemptId: 'demo-attempt-0001',
        candidate: cancel,
        controlBinding,
      },
      injected.value,
    ),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationCompositionError
      && error.code === 'PLACE_ONLY'
    ),
  )
  assert.deepEqual(injected.events, [])
})

test('composition requires every dependency before reading D1 or using credentials', async () => {
  const place = await buildBitgetPlaceOrderCandidate({
    request: {
      productId: 'BTC-USDT',
      side: 'BUY',
      orderType: 'MARKET',
      baseQuantity: null,
      quoteNotional: asDecimalString('100'),
      limitPrice: null,
      stopPrice: null,
    },
    productRules: productRules(),
    clientOrderId: 'demo-place-composition-0001',
    previewHash: '1'.repeat(64),
    force: 'gtc',
    builtAt: BUILT_AT,
    expiresAt: EXPIRES_AT,
  })
  const injected = dependencies({ serializer: null as never })
  await assert.rejects(
    runComposedBitgetDemoPlaceCertification(
      envThatMustNotBeRead(),
      {
        authorizationId: 'demo-authorization-0001',
        dispatchAttemptId: 'demo-attempt-0001',
        candidate: place,
        controlBinding,
      },
      injected.value,
    ),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationCompositionError
      && error.code === 'SERIALIZER_REQUIRED'
    ),
  )
  assert.deepEqual(injected.events, [])
})

test('composition rejects an invalid injected clock before any authority is touched', async () => {
  const place = await buildBitgetPlaceOrderCandidate({
    request: {
      productId: 'BTC-USDT',
      side: 'BUY',
      orderType: 'MARKET',
      baseQuantity: null,
      quoteNotional: asDecimalString('100'),
      limitPrice: null,
      stopPrice: null,
    },
    productRules: productRules(),
    clientOrderId: 'demo-place-composition-0002',
    previewHash: '2'.repeat(64),
    force: 'gtc',
    builtAt: BUILT_AT,
    expiresAt: EXPIRES_AT,
  })
  const injected = dependencies({ clock: { now: () => new Date(Number.NaN) } })
  await assert.rejects(
    runComposedBitgetDemoPlaceCertification(
      envThatMustNotBeRead(),
      {
        authorizationId: 'demo-authorization-0001',
        dispatchAttemptId: 'demo-attempt-0001',
        candidate: place,
        controlBinding,
      },
      injected.value,
    ),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationCompositionError
      && error.code === 'CLOCK_INVALID'
    ),
  )
  assert.deepEqual(injected.events, [])
})
