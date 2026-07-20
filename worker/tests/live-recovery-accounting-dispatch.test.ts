import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeApprovedRecoveryAccountingPackage,
  loadApprovedRecoveryAccountingPackage,
  RecoveryAccountingDispatchConflictError,
  RecoveryAccountingDispatchNotApprovedError,
  type ApprovedRecoveryAccountingPackage,
} from '../src/live/recovery-accounting-dispatch.ts'
import { FillAccountingSerialQueue } from '../src/live/fill-accounting-serialization.ts'
import type { VerifiedFillAccountingResult } from '../src/live/fill-accounting-service.ts'
import { calculateBitgetRecoveryAccountingPlanHash } from '../src/live/recovery-accounting-plan-integrity.ts'
import { asDecimalString, asSignedDecimalString } from '../src/live/decimal.ts'

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
}

class FakeD1 {
  plan: Record<string, unknown> | null = null
  approval: Record<string, unknown> | null = null
  queryCount = 0

  prepare(sql: string): D1PreparedStatement {
    this.queryCount += 1
    const database = this
    const base: FakeStatement = {
      sql,
      params: [],
      bind(...params: unknown[]) {
        return {
          sql,
          params,
          bind: base.bind,
          first: async <T>() => database.first<T>(sql),
        }
      },
      first: async <T>() => database.first<T>(sql),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan as T | null
    if (sql.includes('FROM live_recovery_accounting_approval_events')) {
      return this.approval as T | null
    }
    return null
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

async function rows() {
  const commands = [
    {
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
    },
    {
      exchangeName: 'BITGET' as const,
      exchangeAccountId: 'bitget-account-ref',
      internalOrderId: 'internal-order-2',
      correlationId: 'correlation-2',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      fill: {
        fillId: 'fill-2',
        tradeId: 'trade-2',
        exchangeOrderId: 'exchange-order-2',
        productId: 'BTC-USDT',
        side: 'SELL' as const,
        price: asDecimalString('60000'),
        baseSize: asDecimalString('0.005'),
        commission: asDecimalString('0'),
        commissionAsset: null,
        tradeTime: '2026-07-17T22:01:00.000Z',
        sequenceTimestamp: '2026-07-17T22:01:01.000Z',
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
      rawResponseHash: 'c'.repeat(64),
    },
  ]
  const hashable = {
    exchangeName: 'BITGET' as const,
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoverySnapshotHash: 'a'.repeat(64),
    commandCount: commands.length,
    commands,
    accountingEvidenceReady: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  const planHash = await calculateBitgetRecoveryAccountingPlanHash(hashable)
  return {
    plan: {
      plan_id: 'recovery-plan-1',
      exchange_name: 'BITGET',
      plan_hash: planHash,
      recovery_snapshot_hash: hashable.recoverySnapshotHash,
      exchange_account_id: hashable.exchangeAccountId,
      product_id: hashable.productId,
      command_count: commands.length,
      commands_json: JSON.stringify(commands),
      prepared_by_actor_id: 'planner-1',
      accounting_evidence_ready: 1,
      automatically_dispatched: 0,
      provider_mutation_allowed: 0,
      reservation_applied: 0,
      execution_allowed: 0,
    },
    approval: {
      approval_event_id: 'approval-event-1',
      authorization_event_id: 'authorization-event-1',
      plan_id: 'recovery-plan-1',
      plan_hash: planHash,
      actor_id: 'risk-operator-1',
      plan_prepared_by_actor_id: 'planner-1',
      decision: 'APPROVED',
      authorization_allowed: 1,
      approval_hash: 'd'.repeat(64),
      automatically_dispatched: 0,
      provider_mutation_allowed: 0,
      reservation_applied: 0,
      execution_allowed: 0,
      occurred_at: '2026-07-17T22:02:00.000Z',
    },
  }
}

function accountingResult(
  fillId: string,
  status: 'PROJECTED' | 'REPLAYED' = 'PROJECTED',
): VerifiedFillAccountingResult {
  return {
    status,
    accountingReceiptId: `receipt:${fillId}`,
    fillId,
    journalId: `journal:${fillId}`,
    accountingHash: fillId === 'fill-1' ? 'e'.repeat(64) : 'f'.repeat(64),
    positionQuantity: asDecimalString(fillId === 'fill-1' ? '0.01' : '0.005'),
    cumulativeRealizedPnlQuote: asSignedDecimalString(fillId === 'fill-1' ? '0' : '50'),
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
    exchangeName: 'BITGET',
    replayStateVerified: status === 'REPLAYED',
  }
}

async function approvedPackage(): Promise<ApprovedRecoveryAccountingPackage> {
  const database = new FakeD1()
  const evidence = await rows()
  database.plan = evidence.plan
  database.approval = evidence.approval
  return loadApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
  )
}

test('loader requires matching immutable approved plan evidence', async () => {
  const database = new FakeD1()
  const evidence = await rows()
  database.plan = evidence.plan
  database.approval = evidence.approval

  const loaded = await loadApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
  )

  assert.equal(loaded.operatorApproved, true)
  assert.equal(loaded.plan.commandCount, 2)
  assert.equal(loaded.approvedByActorId, 'risk-operator-1')
  assert.equal(loaded.automaticallyDispatched, false)
  assert.equal(loaded.providerMutationAllowed, false)
  assert.equal(loaded.reservationApplied, false)
  assert.equal(loaded.executionAllowed, false)
})

test('denied, missing, mismatched, or capability-corrupt evidence cannot load', async () => {
  const evidence = await rows()

  const denied = new FakeD1()
  denied.plan = evidence.plan
  denied.approval = { ...evidence.approval, decision: 'DENIED' }
  await assert.rejects(
    loadApprovedRecoveryAccountingPackage(denied.env(), 'recovery-plan-1', 'approval-event-1'),
    RecoveryAccountingDispatchNotApprovedError,
  )

  const missing = new FakeD1()
  await assert.rejects(
    loadApprovedRecoveryAccountingPackage(missing.env(), 'recovery-plan-1', 'approval-event-1'),
    RecoveryAccountingDispatchNotApprovedError,
  )

  const mismatch = new FakeD1()
  mismatch.plan = evidence.plan
  mismatch.approval = { ...evidence.approval, plan_hash: '0'.repeat(64) }
  await assert.rejects(
    loadApprovedRecoveryAccountingPackage(mismatch.env(), 'recovery-plan-1', 'approval-event-1'),
    RecoveryAccountingDispatchConflictError,
  )

  const corrupt = new FakeD1()
  corrupt.plan = { ...evidence.plan, execution_allowed: 1 }
  corrupt.approval = evidence.approval
  await assert.rejects(
    loadApprovedRecoveryAccountingPackage(corrupt.env(), 'recovery-plan-1', 'approval-event-1'),
    /permanent capability locks/,
  )
})

test('approved accounting commands execute serially and complete without automatic retry', async () => {
  const loaded = await approvedPackage()
  const queue = new FillAccountingSerialQueue()
  const order: string[] = []
  const result = await executeApprovedRecoveryAccountingPackage(
    'dispatch-1',
    loaded,
    {
      serializer: queue,
      async executeAccountingCommand(command) {
        order.push(command.fill.fillId)
        return accountingResult(command.fill.fillId)
      },
    },
  )

  assert.deepEqual(order, ['fill-1', 'fill-2'])
  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.completedCommandCount, 2)
  assert.equal(result.failedCommandIndex, null)
  assert.equal(result.automaticallyDispatched, false)
  assert.equal(result.automaticallyRetried, false)
  assert.equal(result.requiresAccountCoordinatorSerialization, true)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.match(result.dispatchHash, /^[a-f0-9]{64}$/)
})

test('failure stops later commands and returns partial evidence without retry', async () => {
  const loaded = await approvedPackage()
  const queue = new FillAccountingSerialQueue()
  let calls = 0
  const result = await executeApprovedRecoveryAccountingPackage(
    'dispatch-partial',
    loaded,
    {
      serializer: queue,
      async executeAccountingCommand(command) {
        calls += 1
        if (command.fill.fillId === 'fill-2') throw new Error('expected failure')
        return accountingResult(command.fill.fillId)
      },
    },
  )

  assert.equal(calls, 2)
  assert.equal(result.status, 'PARTIAL')
  assert.equal(result.completedCommandCount, 1)
  assert.equal(result.failedCommandIndex, 1)
  assert.equal(result.failedFillId, 'fill-2')
  assert.equal(result.failureCode, 'RECOVERY_ACCOUNTING_COMMAND_FAILED')
  assert.equal(result.automaticallyRetried, false)
})

test('first command failure produces failed status and no receipts', async () => {
  const loaded = await approvedPackage()
  const result = await executeApprovedRecoveryAccountingPackage(
    'dispatch-failed',
    loaded,
    {
      serializer: new FillAccountingSerialQueue(),
      async executeAccountingCommand() {
        throw new Error('first failed')
      },
    },
  )

  assert.equal(result.status, 'FAILED')
  assert.equal(result.completedCommandCount, 0)
  assert.deepEqual(result.receipts, [])
  assert.equal(result.failedCommandIndex, 0)
})

test('mismatched accounting result is quarantined as a failed command', async () => {
  const loaded = await approvedPackage()
  const result = await executeApprovedRecoveryAccountingPackage(
    'dispatch-mismatch',
    loaded,
    {
      serializer: new FillAccountingSerialQueue(),
      async executeAccountingCommand(command) {
        return accountingResult(command.fill.fillId === 'fill-1' ? 'different-fill' : command.fill.fillId)
      },
    },
  )

  assert.equal(result.status, 'FAILED')
  assert.equal(result.completedCommandCount, 0)
  assert.equal(result.failedCommandIndex, 0)
})

test('identical dispatch evidence produces deterministic hash', async () => {
  const loaded = await approvedPackage()
  const execute = () => executeApprovedRecoveryAccountingPackage(
    'dispatch-deterministic',
    loaded,
    {
      serializer: new FillAccountingSerialQueue(),
      async executeAccountingCommand(command) {
        return accountingResult(command.fill.fillId, 'REPLAYED')
      },
    },
  )
  const first = await execute()
  const second = await execute()
  assert.equal(first.dispatchHash, second.dispatchHash)
})
