import assert from 'node:assert/strict'
import test from 'node:test'

import type { BitgetRecoveryAccountingPlan } from '../src/live/bitget-recovery-accounting-plan.ts'
import {
  assertBitgetRecoveryAccountingPlanIntegrity,
  calculateBitgetRecoveryAccountingPlanHash,
  RecoveryAccountingPlanIntegrityError,
} from '../src/live/recovery-accounting-plan-integrity.ts'
import { asDecimalString } from '../src/live/decimal.ts'

async function validPlan(): Promise<BitgetRecoveryAccountingPlan> {
  const hashable = {
    exchangeName: 'BITGET' as const,
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoverySnapshotHash: 'a'.repeat(64),
    commandCount: 1,
    commands: [{
      exchangeName: 'BITGET' as const,
      exchangeAccountId: 'bitget-account-ref',
      internalOrderId: 'internal-order-1',
      correlationId: 'correlation-1',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      fill: {
        fillId: 'fill-1',
        tradeId: 'trade-1',
        exchangeOrderId: 'exchange-order-1',
        productId: 'BTC-USDT',
        side: 'BUY' as const,
        price: asDecimalString('50000'),
        baseSize: asDecimalString('0.01'),
        commission: asDecimalString('0'),
        commissionAsset: null,
        tradeTime: '2026-07-17T22:00:00.000Z',
        sequenceTimestamp: '2026-07-17T22:00:01.000Z',
      },
      feeQuoteValue: null,
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
      rawResponseHash: 'b'.repeat(64),
    }],
    accountingEvidenceReady: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  return {
    ...hashable,
    planHash: await calculateBitgetRecoveryAccountingPlanHash(hashable),
  }
}

test('valid recovery accounting plan verifies its exact commands', async () => {
  const plan = await validPlan()
  const verifiedHash = await assertBitgetRecoveryAccountingPlanIntegrity(plan)
  assert.equal(verifiedHash, plan.planHash)
})

test('changing any command after hashing is rejected', async () => {
  const plan = await validPlan()
  const tampered = {
    ...plan,
    commands: [{
      ...plan.commands[0],
      internalOrderId: 'different-order',
    }],
  }

  await assert.rejects(
    assertBitgetRecoveryAccountingPlanIntegrity(tampered),
    RecoveryAccountingPlanIntegrityError,
  )
})

test('command count and scope mismatches fail closed', async () => {
  const plan = await validPlan()
  await assert.rejects(
    assertBitgetRecoveryAccountingPlanIntegrity({ ...plan, commandCount: 2 }),
    /command count is inconsistent/,
  )
  const invalidScope = {
    ...plan,
    commands: [{
      ...plan.commands[0],
      exchangeAccountId: 'other-account',
    }],
  }
  const hashable = { ...invalidScope }
  delete (hashable as Partial<BitgetRecoveryAccountingPlan>).planHash
  const rehashed = {
    ...invalidScope,
    planHash: await calculateBitgetRecoveryAccountingPlanHash(
      hashable as Omit<BitgetRecoveryAccountingPlan, 'planHash'>,
    ),
  }
  await assert.rejects(
    assertBitgetRecoveryAccountingPlanIntegrity(rehashed),
    /does not match the plan scope/,
  )
})

test('capability boundary violations are rejected even with a matching hash', async () => {
  const plan = await validPlan()
  const invalid = {
    ...plan,
    automaticallyDispatched: true as false,
  }
  await assert.rejects(
    assertBitgetRecoveryAccountingPlanIntegrity(invalid),
    /permanent capability boundary/,
  )
})

test('malformed per-fill evidence hash is rejected', async () => {
  const plan = await validPlan()
  const invalidScope = {
    ...plan,
    commands: [{
      ...plan.commands[0],
      rawResponseHash: 'invalid',
    }],
  }
  const hashable = { ...invalidScope }
  delete (hashable as Partial<BitgetRecoveryAccountingPlan>).planHash
  const rehashed = {
    ...invalidScope,
    planHash: await calculateBitgetRecoveryAccountingPlanHash(
      hashable as Omit<BitgetRecoveryAccountingPlan, 'planHash'>,
    ),
  }
  await assert.rejects(
    assertBitgetRecoveryAccountingPlanIntegrity(rehashed),
    /does not match the plan scope/,
  )
})
