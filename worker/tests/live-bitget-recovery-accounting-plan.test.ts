import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBitgetRecoveryAccountingPlan,
  RecoveryAccountingPlanIncompleteError,
  type BitgetRecoveryAccountingPlanInput,
} from '../src/live/bitget-recovery-accounting-plan.ts'
import type { BitgetRestRecoveryResult } from '../src/live/adapters/bitget/recovery.ts'
import { initialBitgetUserStreamCursor } from '../src/live/adapters/bitget/user-stream.ts'
import { asDecimalString } from '../src/live/decimal.ts'

function recovery(
  overrides: Partial<BitgetRestRecoveryResult> = {},
): BitgetRestRecoveryResult {
  const fills: BitgetRestRecoveryResult['snapshot']['fills'] = [
    {
      fillId: 'fill-late',
      tradeId: 'trade-late',
      exchangeOrderId: 'exchange-order-2',
      productId: 'BTC-USDT',
      side: 'SELL',
      price: asDecimalString('60000'),
      baseSize: asDecimalString('0.005'),
      commission: asDecimalString('0.01'),
      commissionAsset: 'BGB',
      tradeTime: '2026-07-17T22:00:02.000Z',
      sequenceTimestamp: '2026-07-17T22:00:02.000Z',
    },
    {
      fillId: 'fill-early',
      tradeId: 'trade-early',
      exchangeOrderId: 'exchange-order-1',
      productId: 'BTC-USDT',
      side: 'BUY',
      price: asDecimalString('50000'),
      baseSize: asDecimalString('0.01'),
      commission: asDecimalString('1'),
      commissionAsset: 'USDT',
      tradeTime: '2026-07-17T22:00:01.000Z',
      sequenceTimestamp: '2026-07-17T22:00:01.000Z',
    },
  ]
  const snapshot = {
    orders: [],
    fills,
    windowStartMs: 1784325600000,
    windowEndMs: 1784325660000,
    serverTimestampMs: 1784325661000,
  }
  return {
    cursor: {
      ...initialBitgetUserStreamCursor(),
      connected: true,
      initialized: true,
      ordersSubscribed: true,
      fillsSubscribed: true,
      lastEventAt: '2026-07-17T22:01:01.000Z',
      lastHeartbeatAt: '2026-07-17T22:01:01.000Z',
      recoveryRequired: false,
      recoveryReason: null,
    },
    snapshot,
    snapshotHash: 'a'.repeat(64),
    orderCount: 0,
    fillCount: fills.length,
    duplicateFillCount: 0,
    rawFillCount: fills.length,
    recoveredAt: '2026-07-17T22:01:01.000Z',
    readOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
    ...overrides,
  }
}

function input(
  overrides: Partial<BitgetRecoveryAccountingPlanInput> = {},
): BitgetRecoveryAccountingPlanInput {
  return {
    recovery: recovery(),
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    orderBindings: [
      {
        exchangeOrderId: 'exchange-order-1',
        internalOrderId: 'internal-order-1',
        correlationId: 'correlation-1',
      },
      {
        exchangeOrderId: 'exchange-order-2',
        internalOrderId: 'internal-order-2',
        correlationId: 'correlation-2',
      },
    ],
    feeQuoteValuations: [
      {
        fillId: 'fill-late',
        feeQuoteValue: asDecimalString('2'),
      },
    ],
    accounts: {
      baseInventoryAccountId: 'ledger:BTC:inventory',
      baseReservedAccountId: 'ledger:BTC:reserved',
      baseClearingAccountId: 'ledger:BTC:clearing',
      quoteAvailableAccountId: 'ledger:USDT:available',
      quoteReservedAccountId: 'ledger:USDT:reserved',
      quoteClearingAccountId: 'ledger:USDT:clearing',
      feeExpenseAccountId: 'ledger:fees',
      feeSourceAccountId: 'ledger:fee-source',
    },
    ...overrides,
  }
}

test('recovery fills become ordered accounting commands without dispatch', async () => {
  const plan = await buildBitgetRecoveryAccountingPlan(input())

  assert.equal(plan.exchangeName, 'BITGET')
  assert.equal(plan.commandCount, 2)
  assert.deepEqual(plan.commands.map((command) => command.fill.fillId), [
    'fill-early',
    'fill-late',
  ])
  assert.equal(plan.commands[0]?.internalOrderId, 'internal-order-1')
  assert.equal(plan.commands[0]?.feeQuoteValue, null)
  assert.equal(plan.commands[1]?.internalOrderId, 'internal-order-2')
  assert.equal(plan.commands[1]?.feeQuoteValue, '2')
  assert.match(plan.commands[0]?.rawResponseHash ?? '', /^[a-f0-9]{64}$/)
  assert.match(plan.commands[1]?.rawResponseHash ?? '', /^[a-f0-9]{64}$/)
  assert.match(plan.planHash, /^[a-f0-9]{64}$/)
  assert.equal(plan.accountingEvidenceReady, true)
  assert.equal(plan.automaticallyDispatched, false)
  assert.equal(plan.providerMutationAllowed, false)
  assert.equal(plan.reservationApplied, false)
  assert.equal(plan.executionAllowed, false)
})

test('identical recovery evidence produces deterministic commands and plan hash', async () => {
  const first = await buildBitgetRecoveryAccountingPlan(input())
  const second = await buildBitgetRecoveryAccountingPlan(input())

  assert.deepEqual(first.commands, second.commands)
  assert.equal(first.planHash, second.planHash)
})

test('missing or duplicate order bindings fail closed', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      orderBindings: input().orderBindings.slice(0, 1),
    })),
    /internal order binding is missing/,
  )

  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      orderBindings: [
        input().orderBindings[0],
        input().orderBindings[0],
      ],
    })),
    /duplicate recovery order binding/,
  )
})

test('third-asset fee requires exact quote valuation', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({ feeQuoteValuations: [] })),
    /third-asset fee quote valuation is required/,
  )

  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      feeQuoteValuations: [{
        fillId: 'fill-late',
        feeQuoteValue: '-1' as unknown as ReturnType<typeof asDecimalString>,
      }],
    })),
    /non-negative base-10 decimal string/,
  )
})

test('extra and duplicate fee valuations fail closed', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      feeQuoteValuations: [{
        fillId: 'not-in-snapshot',
        feeQuoteValue: asDecimalString('1'),
      }],
    })),
    /does not belong to the recovery snapshot/,
  )

  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      feeQuoteValuations: [
        input().feeQuoteValuations[0],
        input().feeQuoteValuations[0],
      ],
    })),
    /duplicate recovery fee valuation/,
  )
})

test('incomplete or mutation-capable recovery evidence is rejected', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      recovery: recovery({
        cursor: {
          ...recovery().cursor,
          recoveryRequired: true,
          recoveryReason: 'event_gap',
        },
      }),
    })),
    /recovery cursor is not complete/,
  )

  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      recovery: recovery({
        providerMutationAllowed: true as false,
      }),
    })),
    /violates the read-only capability boundary/,
  )
})

test('fill count and product mismatches fail closed', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      recovery: recovery({ fillCount: 1 }),
    })),
    /fill count does not match/,
  )

  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({ productId: 'ETH-USDT' })),
    /recovered fill product mismatch/,
  )
})

test('quote fee valuation must equal the exchange commission', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({
      feeQuoteValuations: [
        ...input().feeQuoteValuations,
        {
          fillId: 'fill-early',
          feeQuoteValue: asDecimalString('2'),
        },
      ],
    })),
    /quote-asset fee valuation must equal commission/,
  )
})

test('plan incompleteness uses a dedicated non-execution error class', async () => {
  await assert.rejects(
    buildBitgetRecoveryAccountingPlan(input({ orderBindings: [] })),
    (error: unknown) => {
      assert.ok(error instanceof RecoveryAccountingPlanIncompleteError)
      assert.equal(error.code, 'RECOVERY_ACCOUNTING_PLAN_INCOMPLETE')
      return true
    },
  )
})
