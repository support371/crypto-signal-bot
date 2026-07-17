import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import { buildSpotFillJournal } from '../src/live/ledger.ts'
import {
  buildReservationSettlementPlan,
  type ReservationSettlementInput,
} from '../src/live/reservation-settlement.ts'

function buyFillJournal() {
  return buildSpotFillJournal({
    journalId: 'fill-journal-buy-1',
    exchangeAccountId: 'bitget-account-ref',
    orderId: 'order-1',
    fillId: 'fill-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'fill:1',
    side: 'BUY',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    baseAmount: asDecimalString('0.002'),
    quoteAmount: asDecimalString('100'),
    baseInventoryAccountId: 'ledger:BTC:inventory',
    baseReservedAccountId: 'ledger:BTC:reserved',
    baseClearingAccountId: 'ledger:BTC:clearing',
    quoteAvailableAccountId: 'ledger:USDT:available',
    quoteReservedAccountId: 'ledger:USDT:reserved',
    quoteClearingAccountId: 'ledger:USDT:clearing',
    feeAsset: 'USDT',
    feeAmount: asDecimalString('0.1'),
    feeExpenseAccountId: 'ledger:USDT:fees',
    feeSourceAccountId: 'ledger:USDT:reserved',
  })
}

function input(overrides: Partial<ReservationSettlementInput> = {}): ReservationSettlementInput {
  return {
    settlementReceiptId: 'reservation-settlement:fill-1',
    fillId: 'fill-1',
    accountingHash: 'a'.repeat(64),
    internalOrderId: 'order-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'reservation:settlement:fill-1',
    settledAt: '2026-07-17T21:30:00.000Z',
    terminalFill: false,
    reservation: {
      reservationId: 'reservation-1',
      exchangeAccountId: 'bitget-account-ref',
      orderId: 'order-1',
      asset: 'USDT',
      amount: asDecimalString('150'),
      consumedAmount: asDecimalString('0'),
      status: 'ACTIVE',
      version: 0,
    },
    fillJournal: buyFillJournal(),
    availableAccountId: 'ledger:USDT:available',
    reservedAccountId: 'ledger:USDT:reserved',
    releaseJournalId: 'reservation-release:fill-1',
    ...overrides,
  }
}

test('partial buy fill consumes quote and quote fee from reservation', async () => {
  const plan = await buildReservationSettlementPlan(input())

  assert.equal(plan.consumedDelta, '100.1')
  assert.equal(plan.previousConsumedAmount, '0')
  assert.equal(plan.nextConsumedAmount, '100.1')
  assert.equal(plan.releasedAmount, '0')
  assert.equal(plan.previousStatus, 'ACTIVE')
  assert.equal(plan.nextStatus, 'PARTIALLY_CONSUMED')
  assert.equal(plan.previousVersion, 0)
  assert.equal(plan.nextVersion, 1)
  assert.equal(plan.releaseJournalDraft, null)
  assert.equal(plan.reservationStateUpdated, false)
  assert.equal(plan.releaseJournalPosted, false)
  assert.equal(plan.providerMutationAllowed, false)
  assert.equal(plan.executionAllowed, false)
  assert.match(plan.settlementHash, /^[a-f0-9]{64}$/)
})

test('terminal fill releases the exact unused reservation remainder', async () => {
  const plan = await buildReservationSettlementPlan(input({ terminalFill: true }))

  assert.equal(plan.nextStatus, 'RELEASED')
  assert.equal(plan.nextConsumedAmount, '100.1')
  assert.equal(plan.releasedAmount, '49.9')
  assert.equal(plan.releaseJournalDraft?.eventType, 'FUNDS_RESERVATION_RELEASED')
  assert.deepEqual(
    plan.releaseJournalDraft?.entries.map((entry) => ({
      account: entry.ledgerAccountId,
      direction: entry.direction,
      amount: entry.amount,
    })),
    [
      { account: 'ledger:USDT:available', direction: 'DEBIT', amount: '49.9' },
      { account: 'ledger:USDT:reserved', direction: 'CREDIT', amount: '49.9' },
    ],
  )
})

test('reservation becomes consumed when fill uses the complete amount', async () => {
  const plan = await buildReservationSettlementPlan(input({
    reservation: {
      ...input().reservation,
      amount: asDecimalString('100.1'),
    },
  }))

  assert.equal(plan.nextStatus, 'CONSUMED')
  assert.equal(plan.releasedAmount, '0')
  assert.equal(plan.releaseJournalDraft, null)
})

test('base-denominated sell reservation includes a base-asset fee', async () => {
  const fillJournal = buildSpotFillJournal({
    journalId: 'fill-journal-sell-1',
    exchangeAccountId: 'bitget-account-ref',
    orderId: 'order-1',
    fillId: 'fill-sell-1',
    correlationId: 'correlation-sell-1',
    idempotencyKey: 'fill:sell:1',
    side: 'SELL',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    baseAmount: asDecimalString('0.01'),
    quoteAmount: asDecimalString('600'),
    baseInventoryAccountId: 'ledger:BTC:inventory',
    baseReservedAccountId: 'ledger:BTC:reserved',
    baseClearingAccountId: 'ledger:BTC:clearing',
    quoteAvailableAccountId: 'ledger:USDT:available',
    quoteReservedAccountId: 'ledger:USDT:reserved',
    quoteClearingAccountId: 'ledger:USDT:clearing',
    feeAsset: 'BTC',
    feeAmount: asDecimalString('0.0001'),
    feeExpenseAccountId: 'ledger:BTC:fees',
    feeSourceAccountId: 'ledger:BTC:reserved',
  })
  const plan = await buildReservationSettlementPlan(input({
    fillId: 'fill-sell-1',
    settlementReceiptId: 'reservation-settlement:fill-sell-1',
    fillJournal,
    reservation: {
      ...input().reservation,
      reservationId: 'reservation-sell-1',
      asset: 'BTC',
      amount: asDecimalString('0.02'),
    },
    availableAccountId: 'ledger:BTC:inventory',
    reservedAccountId: 'ledger:BTC:reserved',
    releaseJournalId: 'reservation-release:fill-sell-1',
  }))

  assert.equal(plan.consumedDelta, '0.0101')
  assert.equal(plan.nextConsumedAmount, '0.0101')
})

test('settlement fails closed when journal consumption exceeds reservation', async () => {
  await assert.rejects(
    buildReservationSettlementPlan(input({
      reservation: {
        ...input().reservation,
        amount: asDecimalString('50'),
      },
    })),
    /fill settlement exceeds reserved amount/,
  )
})

test('settlement rejects an unrelated reserved account or mismatched order', async () => {
  await assert.rejects(
    buildReservationSettlementPlan(input({ reservedAccountId: 'ledger:USDT:other' })),
    /reservation consumed delta must be greater than zero/,
  )
  await assert.rejects(
    buildReservationSettlementPlan(input({
      internalOrderId: 'order-other',
    })),
    /reservation order does not match accounting order/,
  )
})

test('identical reservation settlement evidence produces the same hash', async () => {
  const first = await buildReservationSettlementPlan(input())
  const second = await buildReservationSettlementPlan(input())
  assert.equal(first.settlementHash, second.settlementHash)
})
