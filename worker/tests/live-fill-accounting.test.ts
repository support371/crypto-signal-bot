import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountSpotFillFifo,
  InsufficientCostBasisError,
  markPositionToMarket,
  type CostBasisLotState,
  type FillAccountingInput,
} from '../src/live/fill-accounting.ts'
import {
  addSignedDecimal,
  asDecimalString,
  asSignedDecimalString,
  compareSignedDecimal,
} from '../src/live/decimal.ts'

function fill(overrides: Partial<FillAccountingInput['fill']> = {}): FillAccountingInput['fill'] {
  return {
    fillId: 'fill-1',
    tradeId: 'trade-1',
    exchangeOrderId: 'exchange-order-1',
    productId: 'BTC-USDT',
    side: 'BUY',
    price: asDecimalString('50000'),
    baseSize: asDecimalString('0.01'),
    commission: asDecimalString('0'),
    commissionAsset: null,
    tradeTime: '2026-07-17T20:00:00.000Z',
    sequenceTimestamp: '2026-07-17T20:00:01.000Z',
    ...overrides,
  }
}

function lot(
  lotId: string,
  quantity: string,
  cost: string,
  acquiredAt: string,
): CostBasisLotState {
  return {
    lotId,
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    acquiredFillId: `acquired-${lotId}`,
    acquiredAt,
    originalQuantity: asDecimalString(quantity),
    remainingQuantity: asDecimalString(quantity),
    originalCostQuote: asDecimalString(cost),
    remainingCostQuote: asDecimalString(cost),
    unitCostQuote: asDecimalString(
      lotId === 'lot-1' ? '40000' : '50000',
    ),
    method: 'FIFO',
  }
}

function input(overrides: Partial<FillAccountingInput> = {}): FillAccountingInput {
  return {
    journalId: 'fill-journal-1',
    exchangeAccountId: 'bitget-account-ref',
    internalOrderId: 'internal-order-1',
    correlationId: 'correlation-fill-1',
    idempotencyKey: 'fill:accounting:0001',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    fill: fill(),
    existingLots: [],
    cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
    feeQuoteValue: null,
    acquisitionLotId: 'lot-new-1',
    accounts: {
      baseInventoryAccountId: 'ledger:BTC:inventory',
      baseReservedAccountId: 'ledger:BTC:reserved',
      baseClearingAccountId: 'ledger:BTC:clearing',
      quoteAvailableAccountId: 'ledger:USDT:available',
      quoteReservedAccountId: 'ledger:USDT:reserved',
      quoteClearingAccountId: 'ledger:USDT:clearing',
      feeExpenseAccountId: null,
      feeSourceAccountId: null,
    },
    ...overrides,
  }
}

test('signed decimal accumulation remains exact across profit and loss', () => {
  assert.equal(
    addSignedDecimal(asSignedDecimalString('10.25'), asSignedDecimalString('-3.5')),
    '6.75',
  )
  assert.equal(
    compareSignedDecimal(asSignedDecimalString('-0.01'), asSignedDecimalString('0')),
    -1,
  )
})

test('buy fill creates an immutable FIFO acquisition lot and balanced asset journal', async () => {
  const result = await accountSpotFillFifo(input())

  assert.equal(result.acquiredLot?.originalQuantity, '0.01')
  assert.equal(result.acquiredLot?.originalCostQuote, '500')
  assert.equal(result.acquiredLot?.unitCostQuote, '50000')
  assert.equal(result.position.quantity, '0.01')
  assert.equal(result.position.totalCostBasisQuote, '500')
  assert.equal(result.position.averageEntryPrice, '50000')
  assert.equal(result.position.cumulativeRealizedPnlQuote, '0')
  assert.equal(result.journal.entries.length, 4)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.match(result.accountingHash, /^[a-f0-9]{64}$/)
})

test('quote-asset buy fee increases lot cost basis', async () => {
  const result = await accountSpotFillFifo(input({
    fill: fill({
      commission: asDecimalString('0.5'),
      commissionAsset: 'USDT',
    }),
    feeQuoteValue: asDecimalString('0.5'),
    accounts: {
      ...input().accounts,
      feeExpenseAccountId: 'ledger:USDT:fees',
      feeSourceAccountId: 'ledger:USDT:reserved',
    },
  }))

  assert.equal(result.acquiredLot?.originalQuantity, '0.01')
  assert.equal(result.acquiredLot?.originalCostQuote, '500.5')
  assert.equal(result.acquiredLot?.unitCostQuote, '50050')
  assert.equal(result.journal.entries.length, 6)
})

test('base-asset buy fee reduces acquired quantity without inventing quote cost', async () => {
  const result = await accountSpotFillFifo(input({
    fill: fill({
      commission: asDecimalString('0.00001'),
      commissionAsset: 'BTC',
    }),
    accounts: {
      ...input().accounts,
      feeExpenseAccountId: 'ledger:BTC:fees',
      feeSourceAccountId: 'ledger:BTC:inventory',
    },
  }))

  assert.equal(result.acquiredLot?.originalQuantity, '0.00999')
  assert.equal(result.acquiredLot?.originalCostQuote, '500')
  assert.equal(result.position.quantity, '0.00999')
})

test('sell fill consumes FIFO lots exactly and records realized profit', async () => {
  const result = await accountSpotFillFifo(input({
    fill: fill({
      fillId: 'fill-sell-1',
      tradeId: 'trade-sell-1',
      side: 'SELL',
      price: asDecimalString('60000'),
      baseSize: asDecimalString('0.015'),
    }),
    existingLots: [
      lot('lot-1', '0.01', '400', '2026-07-15T10:00:00.000Z'),
      lot('lot-2', '0.02', '1000', '2026-07-16T10:00:00.000Z'),
    ],
  }))

  assert.deepEqual(result.lotConsumptions.map((item) => ({
    lotId: item.lotId,
    quantity: item.quantity,
    cost: item.costBasisQuote,
  })), [
    { lotId: 'lot-1', quantity: '0.01', cost: '400' },
    { lotId: 'lot-2', quantity: '0.005', cost: '250' },
  ])
  assert.equal(result.realizedPnlEvent?.grossProceedsQuote, '900')
  assert.equal(result.realizedPnlEvent?.netProceedsQuote, '900')
  assert.equal(result.realizedPnlEvent?.costBasisQuote, '650')
  assert.equal(result.realizedPnlEvent?.realizedPnlQuote, '250')
  assert.equal(result.position.quantity, '0.015')
  assert.equal(result.position.totalCostBasisQuote, '750')
  assert.equal(result.position.averageEntryPrice, '50000')
  assert.equal(result.position.cumulativeRealizedPnlQuote, '250')
})

test('quote and third-asset sell fees reduce realized PnL by exact quote value', async () => {
  const lots = [
    lot('lot-1', '0.01', '400', '2026-07-15T10:00:00.000Z'),
    lot('lot-2', '0.02', '1000', '2026-07-16T10:00:00.000Z'),
  ]
  const quoteFee = await accountSpotFillFifo(input({
    fill: fill({
      fillId: 'fill-sell-quote-fee',
      tradeId: 'trade-sell-quote-fee',
      side: 'SELL',
      price: asDecimalString('60000'),
      baseSize: asDecimalString('0.015'),
      commission: asDecimalString('1'),
      commissionAsset: 'USDT',
    }),
    existingLots: lots,
    feeQuoteValue: asDecimalString('1'),
    accounts: {
      ...input().accounts,
      feeExpenseAccountId: 'ledger:USDT:fees',
      feeSourceAccountId: 'ledger:USDT:available',
    },
  }))
  assert.equal(quoteFee.realizedPnlEvent?.netProceedsQuote, '899')
  assert.equal(quoteFee.realizedPnlEvent?.realizedPnlQuote, '249')

  const thirdAssetFee = await accountSpotFillFifo(input({
    fill: fill({
      fillId: 'fill-sell-third-fee',
      tradeId: 'trade-sell-third-fee',
      side: 'SELL',
      price: asDecimalString('60000'),
      baseSize: asDecimalString('0.015'),
      commission: asDecimalString('0.01'),
      commissionAsset: 'BGB',
    }),
    existingLots: lots,
    feeQuoteValue: asDecimalString('2'),
    accounts: {
      ...input().accounts,
      feeExpenseAccountId: 'ledger:BGB:fees',
      feeSourceAccountId: 'ledger:BGB:available',
    },
  }))
  assert.equal(thirdAssetFee.realizedPnlEvent?.feeQuoteValue, '2')
  assert.equal(thirdAssetFee.realizedPnlEvent?.realizedPnlQuote, '248')
})

test('base-asset sell fee consumes additional FIFO quantity', async () => {
  const result = await accountSpotFillFifo(input({
    fill: fill({
      fillId: 'fill-sell-base-fee',
      tradeId: 'trade-sell-base-fee',
      side: 'SELL',
      price: asDecimalString('60000'),
      baseSize: asDecimalString('0.015'),
      commission: asDecimalString('0.001'),
      commissionAsset: 'BTC',
    }),
    existingLots: [
      lot('lot-1', '0.01', '400', '2026-07-15T10:00:00.000Z'),
      lot('lot-2', '0.02', '1000', '2026-07-16T10:00:00.000Z'),
    ],
    accounts: {
      ...input().accounts,
      feeExpenseAccountId: 'ledger:BTC:fees',
      feeSourceAccountId: 'ledger:BTC:reserved',
    },
  }))

  assert.equal(result.realizedPnlEvent?.disposedQuantity, '0.016')
  assert.equal(result.realizedPnlEvent?.costBasisQuote, '700')
  assert.equal(result.realizedPnlEvent?.realizedPnlQuote, '200')
  assert.equal(result.position.quantity, '0.014')
  assert.equal(result.position.totalCostBasisQuote, '700')
})

test('insufficient FIFO lots fail closed without accounting result', async () => {
  await assert.rejects(
    accountSpotFillFifo(input({
      fill: fill({
        side: 'SELL',
        baseSize: asDecimalString('0.02'),
      }),
      existingLots: [lot('lot-1', '0.01', '400', '2026-07-15T10:00:00.000Z')],
    })),
    InsufficientCostBasisError,
  )
})

test('mark-to-market computes exact unrealized profit and loss', async () => {
  const bought = await accountSpotFillFifo(input())
  const profit = markPositionToMarket(
    bought.position,
    asDecimalString('55000'),
    '2026-07-17T21:00:00.000Z',
  )
  const loss = markPositionToMarket(
    bought.position,
    asDecimalString('45000'),
    '2026-07-17T21:01:00.000Z',
  )

  assert.equal(profit.marketValueQuote, '550')
  assert.equal(profit.unrealizedPnlQuote, '50')
  assert.equal(loss.marketValueQuote, '450')
  assert.equal(loss.unrealizedPnlQuote, '-50')
})

test('identical accounting evidence produces deterministic hash', async () => {
  const first = await accountSpotFillFifo(input())
  const second = await accountSpotFillFifo(input())
  assert.equal(first.accountingHash, second.accountingHash)
})
