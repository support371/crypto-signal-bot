import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import {
  buildBitgetRecoveryIngestionPlan,
  type BitgetRecoveryIngestionInput,
} from '../src/live/recovery-ingestion.ts'

function input(
  overrides: Partial<BitgetRecoveryIngestionInput> = {},
): BitgetRecoveryIngestionInput {
  return {
    ingestionId: 'recovery-ingestion-1',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoveredAt: '2026-07-17T22:30:00.000Z',
    recovery: {
      snapshot: {
        orders: [{
          exchangeOrderId: 'order-1',
          clientOrderId: 'client-1',
          productId: 'BTC-USDT',
          side: 'BUY',
          orderType: 'LIMIT',
          rawStatus: 'filled',
          requestedBaseQuantity: asDecimalString('0.01'),
          requestedQuoteNotional: null,
          filledBaseQuantity: asDecimalString('0.01'),
          filledQuoteValue: asDecimalString('500'),
          remainingBaseQuantity: asDecimalString('0'),
          averageFillPrice: asDecimalString('50000'),
          totalFees: asDecimalString('0.5'),
          pendingCancel: false,
          settled: true,
          createdAt: '2026-07-17T22:00:00.000Z',
          updatedAt: '2026-07-17T22:10:00.000Z',
        }],
        fills: [{
          fillId: 'fill-1',
          tradeId: 'trade-1',
          exchangeOrderId: 'order-1',
          productId: 'BTC-USDT',
          side: 'BUY',
          price: asDecimalString('50000'),
          baseSize: asDecimalString('0.01'),
          commission: asDecimalString('0.5'),
          commissionAsset: 'USDT',
          tradeTime: '2026-07-17T22:10:00.000Z',
          sequenceTimestamp: '2026-07-17T22:10:00.100Z',
        }],
        snapshotAt: '2026-07-17T22:29:59.000Z',
        serverTimestampMs: 1784327399000,
      },
      cursor: {
        connected: true,
        initialized: true,
        ordersSubscribed: true,
        fillsSubscribed: true,
        lastMessageAt: '2026-07-17T22:29:59.000Z',
        lastPongAt: null,
        lastServerTimestampMs: 1784327399000,
        lastRestSnapshotAt: '2026-07-17T22:29:59.000Z',
        recentFingerprints: [],
        recoveryRequired: false,
        recoveryReason: null,
      },
      snapshotHash: 'a'.repeat(64),
      windowStartMs: 1784325600000,
      windowEndMs: 1784327400000,
      currentOrderCount: 0,
      historicalOrderCount: 1,
      fillCount: 1,
      readOnly: true,
      providerMutationAllowed: false,
      executionAllowed: false,
    },
    ...overrides,
  }
}

test('recovery ingestion creates immutable order, fill, and accounting-task evidence', async () => {
  const plan = await buildBitgetRecoveryIngestionPlan(input())

  assert.equal(plan.provider, 'BITGET')
  assert.equal(plan.snapshotId, `bitget-recovery:${'a'.repeat(32)}`)
  assert.equal(plan.orderObservations.length, 1)
  assert.equal(plan.fillObservations.length, 1)
  assert.equal(plan.accountingTaskIntents.length, 1)
  assert.equal(plan.fillObservations[0]?.fillId, 'fill-1')
  assert.equal(plan.accountingTaskIntents[0]?.fillId, 'fill-1')
  assert.equal(plan.accountingTaskIntents[0]?.status, 'PENDING_ACCOUNTING')
  assert.equal(plan.complete, true)
  assert.equal(plan.bounded, true)
  assert.equal(plan.readOnly, true)
  assert.equal(plan.accountingApplied, false)
  assert.equal(plan.reservationSettled, false)
  assert.equal(plan.providerMutationAllowed, false)
  assert.equal(plan.executionAllowed, false)
  assert.match(plan.requestHash, /^[a-f0-9]{64}$/)
  assert.match(plan.ingestionHash, /^[a-f0-9]{64}$/)
})

test('identical recovery evidence produces deterministic hashes and task IDs', async () => {
  const first = await buildBitgetRecoveryIngestionPlan(input())
  const second = await buildBitgetRecoveryIngestionPlan(input())

  assert.equal(first.requestHash, second.requestHash)
  assert.equal(first.ingestionHash, second.ingestionHash)
  assert.equal(
    first.accountingTaskIntents[0]?.taskIntentId,
    second.accountingTaskIntents[0]?.taskIntentId,
  )
})

test('recovery product mismatch fails before persistence', async () => {
  await assert.rejects(
    buildBitgetRecoveryIngestionPlan(input({ productId: 'ETH-USDT' })),
    /recovered order product mismatch/,
  )
})

test('recovery cursor or capability lock violations fail closed', async () => {
  await assert.rejects(
    buildBitgetRecoveryIngestionPlan(input({
      recovery: {
        ...input().recovery,
        cursor: {
          ...input().recovery.cursor,
          recoveryRequired: true,
          recoveryReason: 'snapshot_incomplete',
        },
      },
    })),
    /cursor is not fully recovered/,
  )

  await assert.rejects(
    buildBitgetRecoveryIngestionPlan(input({
      recovery: {
        ...input().recovery,
        executionAllowed: true,
      },
    })),
    /violates read-only capability locks/,
  )
})

test('empty complete snapshot creates no accounting task intents', async () => {
  const base = input()
  const plan = await buildBitgetRecoveryIngestionPlan(input({
    recovery: {
      ...base.recovery,
      snapshot: {
        ...base.recovery.snapshot,
        orders: [],
        fills: [],
      },
      currentOrderCount: 0,
      historicalOrderCount: 0,
      fillCount: 0,
    },
  }))

  assert.equal(plan.orderObservations.length, 0)
  assert.equal(plan.fillObservations.length, 0)
  assert.equal(plan.accountingTaskIntents.length, 0)
})
