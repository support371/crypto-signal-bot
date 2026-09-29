import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import type { ExchangeOrderSnapshot } from '../src/live/exchange-contracts.ts'
import type { BitgetRestRecoveryResult } from '../src/live/adapters/bitget/recovery.ts'
import {
  BitgetRecoveryReconciliationError,
  reconcileBitgetRecoverySnapshot,
} from '../src/live/bitget-recovery-reconciliation.ts'
import type { RecoveryLookupInstruction } from '../src/live/recovery-reconciliation-plan.ts'

function order(overrides: Partial<ExchangeOrderSnapshot> = {}): ExchangeOrderSnapshot {
  return {
    exchangeOrderId: 'exchange-1',
    clientOrderId: 'client-1',
    productId: 'BTC-USDT',
    side: 'BUY',
    orderType: 'LIMIT',
    rawStatus: 'filled',
    requestedBaseQuantity: asDecimalString('0.01'),
    requestedQuoteNotional: null,
    filledBaseQuantity: asDecimalString('0.01'),
    filledQuoteValue: asDecimalString('800'),
    remainingBaseQuantity: asDecimalString('0'),
    averageFillPrice: asDecimalString('80000'),
    totalFees: asDecimalString('0.8'),
    pendingCancel: false,
    settled: false,
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-29T08:01:00.000Z',
    ...overrides,
  }
}

function recovery(orders: readonly ExchangeOrderSnapshot[]): BitgetRestRecoveryResult {
  return {
    snapshot: {
      orders,
      fills: [],
      snapshotAt: '2026-09-29T08:02:00.000Z',
      serverTimestampMs: 1790668920000,
    },
    cursor: {
      connectionState: 'RECOVERED',
      lastSequenceTimestamp: '2026-09-29T08:02:00.000Z',
      lastEventId: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      recoveredAt: '2026-09-29T08:02:00.000Z',
    },
    snapshotHash: 'a'.repeat(64),
    windowStartMs: 1790668800000,
    windowEndMs: 1790668920000,
    currentOrderCount: 0,
    historicalOrderCount: orders.length,
    fillCount: 0,
    readOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
  }
}

function instruction(overrides: Partial<RecoveryLookupInstruction> = {}): RecoveryLookupInstruction {
  return {
    internalOrderId: 'internal-1',
    exchangeAccountId: 'account-1',
    productId: 'BTC-USDT',
    lookupBy: 'EXCHANGE_ORDER_ID',
    lookupValue: 'exchange-1',
    method: 'GET',
    mutationAllowed: false,
    automaticRetryAllowed: false,
    ...overrides,
  }
}

test('reconciles an exact recovered Bitget order into a terminal decision', () => {
  const result = reconcileBitgetRecoverySnapshot(
    instruction(),
    recovery([order()]),
    asDecimalString('0.01'),
  )
  assert.equal(result.decision.state, 'FILLED')
  assert.equal(result.decision.action, 'FINALIZE')
  assert.equal(result.recoverySnapshotHash, 'a'.repeat(64))
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
})

test('supports client-order identity for ambiguous-submission recovery', () => {
  const result = reconcileBitgetRecoverySnapshot(
    instruction({
      lookupBy: 'CLIENT_ORDER_ID',
      lookupValue: 'client-1',
    }),
    recovery([order({ exchangeOrderId: null })]),
    asDecimalString('0.01'),
  )
  assert.equal(result.matchedOrder.clientOrderId, 'client-1')
  assert.equal(result.decision.state, 'RECOVERY_REQUIRED')
  assert.equal(result.decision.reason, 'exchange_order_id_missing')
})

test('fails closed when the provider order identity is absent', () => {
  assert.throws(
    () => reconcileBitgetRecoverySnapshot(
      instruction(),
      recovery([order({ exchangeOrderId: 'exchange-other' })]),
      asDecimalString('0.01'),
    ),
    (error: unknown) => error instanceof BitgetRecoveryReconciliationError
      && error.code === 'RECOVERY_ORDER_NOT_FOUND',
  )
})

test('fails closed on product mismatch', () => {
  assert.throws(
    () => reconcileBitgetRecoverySnapshot(
      instruction(),
      recovery([order({ productId: 'ETH-USDT' })]),
      asDecimalString('0.01'),
    ),
    (error: unknown) => error instanceof BitgetRecoveryReconciliationError
      && error.code === 'RECOVERY_PRODUCT_MISMATCH',
  )
})
