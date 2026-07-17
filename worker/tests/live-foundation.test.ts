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
