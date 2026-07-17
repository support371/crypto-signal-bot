import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import {
  buildReservationJournal,
  buildReservationReleaseJournal,
  buildSpotFillJournal,
  UnbalancedJournalError,
  validateBalancedJournal,
} from '../src/live/ledger.ts'

test('reservation and release journals balance exactly', () => {
  const common = {
    exchangeAccountId: 'account-ref-hash',
    orderId: 'order-1',
    correlationId: 'correlation-1',
    asset: 'usd',
    amount: asDecimalString('125.50'),
    availableAccountId: 'usd:cash-available',
    reservedAccountId: 'usd:cash-reserved',
  }

  const reserved = buildReservationJournal({
    ...common,
    journalId: 'journal-reserve-1',
    idempotencyKey: 'reserve:order:0001',
  })
  const released = buildReservationReleaseJournal({
    ...common,
    journalId: 'journal-release-1',
    idempotencyKey: 'release:order:0001',
  })

  assert.equal(reserved.entries.length, 2)
  assert.equal(released.entries.length, 2)
  assert.equal(reserved.entries[0].asset, 'USD')
  assert.equal(reserved.entries[0].amount, '125.5')
})

test('spot buy fill balances base, quote, and fee assets independently', () => {
  const journal = buildSpotFillJournal({
    journalId: 'journal-fill-1',
    exchangeAccountId: 'account-ref-hash',
    orderId: 'order-1',
    fillId: 'fill-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'fill:order:0001',
    side: 'BUY',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    baseAmount: asDecimalString('0.001'),
    quoteAmount: asDecimalString('100'),
    baseInventoryAccountId: 'btc:inventory-available',
    baseReservedAccountId: 'btc:inventory-reserved',
    baseClearingAccountId: 'btc:exchange-clearing',
    quoteAvailableAccountId: 'usd:cash-available',
    quoteReservedAccountId: 'usd:cash-reserved',
    quoteClearingAccountId: 'usd:exchange-clearing',
    feeAsset: 'USD',
    feeAmount: asDecimalString('0.4'),
    feeExpenseAccountId: 'usd:fees-expense',
    feeSourceAccountId: 'usd:cash-reserved',
  })

  assert.equal(journal.entries.length, 6)
  assert.doesNotThrow(() => validateBalancedJournal(journal))
})

test('unbalanced journals are rejected with per-asset differences', () => {
  assert.throws(
    () => validateBalancedJournal({
      journalId: 'journal-bad-1',
      exchangeAccountId: 'account-ref-hash',
      eventType: 'TEST',
      referenceType: 'TEST',
      referenceId: 'reference-1',
      correlationId: 'correlation-1',
      idempotencyKey: 'journal:test:0001',
      entries: [
        {
          entryId: 'entry-1',
          ledgerAccountId: 'usd:cash-available',
          asset: 'USD',
          direction: 'DEBIT',
          amount: asDecimalString('10'),
        },
        {
          entryId: 'entry-2',
          ledgerAccountId: 'usd:exchange-clearing',
          asset: 'USD',
          direction: 'CREDIT',
          amount: asDecimalString('9.99'),
        },
      ],
    }),
    (error: unknown) => {
      assert.ok(error instanceof UnbalancedJournalError)
      assert.deepEqual(error.differences.USD, { debits: '10', credits: '9.99' })
      return true
    },
  )
})
