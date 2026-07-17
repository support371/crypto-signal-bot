import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateSignedLedgerBalance,
  reconcileFillAccounting,
  type FillAccountingReconciliationInput,
} from '../src/live/fill-accounting-reconciliation.ts'
import {
  asDecimalString,
  asSignedDecimalString,
} from '../src/live/decimal.ts'

function input(
  overrides: Partial<FillAccountingReconciliationInput> = {},
): FillAccountingReconciliationInput {
  return {
    reconciliationId: 'accounting-reconciliation-1',
    exchangeName: 'BITGET',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    position: {
      quantity: asDecimalString('0.02'),
      totalCostBasisQuote: asDecimalString('900'),
      averageEntryPrice: asDecimalString('45000'),
      cumulativeRealizedPnlQuote: asSignedDecimalString('240'),
      status: 'OPEN',
    },
    lots: [
      {
        lotId: 'lot-1',
        remainingQuantity: asDecimalString('0.01'),
        remainingCostQuote: asDecimalString('400'),
      },
      {
        lotId: 'lot-2',
        remainingQuantity: asDecimalString('0.01'),
        remainingCostQuote: asDecimalString('500'),
      },
    ],
    realizedPnlEvents: [
      asSignedDecimalString('250'),
      asSignedDecimalString('-10'),
    ],
    ledgerBaseInventoryBalance: asSignedDecimalString('0.02'),
    exchangeBaseBalance: asDecimalString('0.02'),
    currentPrice: asDecimalString('60000'),
    observedAt: '2026-07-17T22:00:00.000Z',
    ...overrides,
  }
}

test('matching lots position ledger exchange and PnL reconcile clear', async () => {
  const result = await reconcileFillAccounting(input())

  assert.equal(result.status, 'CLEAR')
  assert.deepEqual(result.reasons, [])
  assert.equal(result.reconstructedQuantity, '0.02')
  assert.equal(result.reconstructedCostBasisQuote, '900')
  assert.equal(result.reconstructedAverageEntryPrice, '45000')
  assert.equal(result.reconstructedRealizedPnlQuote, '240')
  assert.equal(result.marketValueQuote, '1200')
  assert.equal(result.unrealizedPnlQuote, '300')
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.match(result.reconciliationHash, /^[a-f0-9]{64}$/)
})

test('position lot and realized PnL mismatches halt for review', async () => {
  const result = await reconcileFillAccounting(input({
    position: {
      quantity: asDecimalString('0.03'),
      totalCostBasisQuote: asDecimalString('950'),
      averageEntryPrice: asDecimalString('31666.666666666666666666'),
      cumulativeRealizedPnlQuote: asSignedDecimalString('200'),
      status: 'OPEN',
    },
    ledgerBaseInventoryBalance: asSignedDecimalString('0.03'),
    exchangeBaseBalance: asDecimalString('0.03'),
  }))

  assert.equal(result.status, 'HALT_FOR_REVIEW')
  assert.ok(result.reasons.includes('lot_quantity_mismatch'))
  assert.ok(result.reasons.includes('lot_cost_basis_mismatch'))
  assert.ok(result.reasons.includes('average_entry_price_mismatch'))
  assert.ok(result.reasons.includes('realized_pnl_mismatch'))
})

test('ledger and exchange quantity mismatches halt independently', async () => {
  const result = await reconcileFillAccounting(input({
    ledgerBaseInventoryBalance: asSignedDecimalString('0.019'),
    exchangeBaseBalance: asDecimalString('0.021'),
  }))

  assert.equal(result.status, 'HALT_FOR_REVIEW')
  assert.ok(result.reasons.includes('ledger_position_quantity_mismatch'))
  assert.ok(result.reasons.includes('exchange_position_quantity_mismatch'))
})

test('negative ledger inventory is a distinct halt reason', async () => {
  const result = await reconcileFillAccounting(input({
    ledgerBaseInventoryBalance: asSignedDecimalString('-0.001'),
  }))

  assert.equal(result.status, 'HALT_FOR_REVIEW')
  assert.ok(result.reasons.includes('ledger_inventory_negative'))
  assert.equal(result.reasons.includes('ledger_position_quantity_mismatch'), false)
})

test('closed position requires zero lots zero cost and null average entry', async () => {
  const result = await reconcileFillAccounting(input({
    position: {
      quantity: asDecimalString('0'),
      totalCostBasisQuote: asDecimalString('0'),
      averageEntryPrice: null,
      cumulativeRealizedPnlQuote: asSignedDecimalString('240'),
      status: 'CLOSED',
    },
    lots: [],
    ledgerBaseInventoryBalance: asSignedDecimalString('0'),
    exchangeBaseBalance: asDecimalString('0'),
    currentPrice: asDecimalString('60000'),
  }))

  assert.equal(result.status, 'CLEAR')
  assert.equal(result.reconstructedAverageEntryPrice, null)
  assert.equal(result.marketValueQuote, '0')
  assert.equal(result.unrealizedPnlQuote, '0')
})

test('invalid position status and non-positive current price halt for review', async () => {
  const result = await reconcileFillAccounting(input({
    position: {
      ...input().position,
      status: 'CLOSED',
    },
    currentPrice: asDecimalString('0'),
  }))

  assert.equal(result.status, 'HALT_FOR_REVIEW')
  assert.ok(result.reasons.includes('position_status_inconsistent'))
  assert.ok(result.reasons.includes('current_price_not_positive'))
  assert.equal(result.marketValueQuote, null)
  assert.equal(result.unrealizedPnlQuote, null)
})

test('lot closure inconsistency and duplicate lot IDs fail closed', async () => {
  await assert.rejects(
    reconcileFillAccounting(input({
      lots: [{
        lotId: 'lot-1',
        remainingQuantity: asDecimalString('0'),
        remainingCostQuote: asDecimalString('1'),
      }],
    })),
    /quantity and cost closure are inconsistent/,
  )

  await assert.rejects(
    reconcileFillAccounting(input({
      lots: [input().lots[0], input().lots[0]],
    })),
    /duplicate lot ID/,
  )
})

test('signed ledger balance treats debits as inventory increases and credits as decreases', () => {
  const balance = calculateSignedLedgerBalance([
    { direction: 'DEBIT', amount: asDecimalString('0.03') },
    { direction: 'CREDIT', amount: asDecimalString('0.01') },
    { direction: 'DEBIT', amount: asDecimalString('0.005') },
  ])

  assert.equal(balance, '0.025')
})

test('identical reconciliation evidence produces deterministic hash', async () => {
  const first = await reconcileFillAccounting(input())
  const second = await reconcileFillAccounting(input())
  assert.equal(first.reconciliationHash, second.reconciliationHash)
})
