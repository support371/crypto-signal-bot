import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeVerifiedRecoveryAccountingPackage,
  loadVerifiedApprovedRecoveryAccountingPackage,
} from '../src/live/recovery-accounting-dispatch-service.ts'
import {
  persistVerifiedRecoveryAccountingDispatchResult,
} from '../src/live/recovery-accounting-dispatch-persistence.ts'
import {
  RecoveryAccountingDispatchStoreConflictError,
} from '../src/live/recovery-accounting-dispatch-store.ts'
import {
  RecoveryAccountingDispatchNotApprovedError,
  type RecoveryAccountingDispatchResult,
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
  all<T>(): Promise<{ results: T[] }>
}

class FakeD1 {
  plan: Record<string, unknown> | null = null
  approval: Record<string, unknown> | null = null
  dispatch: Record<string, unknown> | null = null
  receipts: Record<string, unknown>[] = []
  batchCount = 0

  prepare(sql: string): D1PreparedStatement {
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
          all: async <T>() => database.all<T>(sql),
        }
      },
      first: async <T>() => database.first<T>(sql),
      all: async <T>() => database.all<T>(sql),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan as T | null
    if (sql.includes('FROM live_recovery_accounting_approval_events')) {
      return this.approval as T | null
    }
    if (sql.includes('FROM live_recovery_accounting_dispatches')) {
      return this.dispatch as T | null
    }
    return null
  }

  async all<T>(sql: string): Promise<{ results: T[] }> {
    if (sql.includes('FROM live_recovery_accounting_dispatch_receipts')) {
      return { results: this.receipts as T[] }
    }
    return { results: [] }
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    const bound = statements as unknown as FakeStatement[]
    const summary = bound[0]
    const params = summary.params
    this.dispatch = {
      dispatch_id: String(params[0]),
      plan_id: String(params[1]),
      approval_event_id: String(params[2]),
      plan_hash: String(params[3]),
      status: String(params[4]),
      command_count: Number(params[5]),
      completed_command_count: Number(params[6]),
      failed_command_index: params[7] === null ? null : Number(params[7]),
      failed_fill_id: params[8] === null ? null : String(params[8]),
      failure_code: params[9] === null ? null : String(params[9]),
      dispatch_hash: String(params[10]),
      operator_approved: 1,
      automatically_dispatched: 0,
      automatically_retried: 0,
      requires_coordinator_serialization: 1,
      provider_mutation_allowed: 0,
      reservation_applied: 0,
      execution_allowed: 0,
      occurred_at: String(params[11]),
    }
    this.receipts = bound.slice(1).map((statement) => {
      const receipt = statement.params
      return {
        command_index: Number(receipt[1]),
        fill_id: String(receipt[2]),
        result_status: String(receipt[3]),
        accounting_receipt_id: String(receipt[4]),
        journal_id: String(receipt[5]),
        accounting_hash: String(receipt[6]),
        position_quantity: String(receipt[7]),
        cumulative_realized_pnl_quote: String(receipt[8]),
        provider_mutation_allowed: 0,
        reservation_applied: 0,
        execution_allowed: 0,
      }
    })
    return []
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

async function evidenceRows() {
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
      plan_hash: planHash,
      recovery_snapshot_hash: hashable.recoverySnapshotHash,
      exchange_account_id: hashable.exchangeAccountId,
      product_id: hashable.productId,
      command_count: commands.length,
      commands_json: JSON.stringify(commands),
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

function accountingResult(fillId: string): VerifiedFillAccountingResult {
  return {
    status: 'PROJECTED',
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
    replayStateVerified: false,
  }
}

async function completedDispatch(database: FakeD1): Promise<RecoveryAccountingDispatchResult> {
  const approved = await loadVerifiedApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
  )
  return executeVerifiedRecoveryAccountingPackage(
    'dispatch-1',
    approved,
    {
      serializer: new FillAccountingSerialQueue(),
      async executeAccountingCommand(command) {
        return accountingResult(command.fill.fillId)
      },
    },
  )
}

async function configuredDatabase(): Promise<FakeD1> {
  const database = new FakeD1()
  const evidence = await evidenceRows()
  database.plan = evidence.plan
  database.approval = evidence.approval
  return database
}

test('completed dispatch persists summary and command receipts in one batch', async () => {
  const database = await configuredDatabase()
  const result = await completedDispatch(database)
  const projected = await persistVerifiedRecoveryAccountingDispatchResult(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    result,
    '2026-07-17T22:03:00.000Z',
  )

  assert.equal(projected.projectionStatus, 'PROJECTED')
  assert.equal(projected.status, 'COMPLETED')
  assert.equal(projected.completedCommandCount, 2)
  assert.equal(projected.operatorApproved, true)
  assert.equal(projected.automaticallyDispatched, false)
  assert.equal(projected.automaticallyRetried, false)
  assert.equal(projected.requiresAccountCoordinatorSerialization, true)
  assert.equal(projected.providerMutationAllowed, false)
  assert.equal(projected.reservationApplied, false)
  assert.equal(projected.executionAllowed, false)
  assert.equal(database.batchCount, 1)
  assert.equal(database.receipts.length, 2)
})

test('identical dispatch evidence replays without another batch', async () => {
  const database = await configuredDatabase()
  const result = await completedDispatch(database)
  await persistVerifiedRecoveryAccountingDispatchResult(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    result,
    '2026-07-17T22:03:00.000Z',
  )
  const replay = await persistVerifiedRecoveryAccountingDispatchResult(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    result,
    '2026-07-17T22:03:00.000Z',
  )

  assert.equal(replay.projectionStatus, 'REPLAYED')
  assert.equal(database.batchCount, 1)
})

test('same dispatch ID with changed receipts is rejected', async () => {
  const database = await configuredDatabase()
  const result = await completedDispatch(database)
  await persistVerifiedRecoveryAccountingDispatchResult(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    result,
    '2026-07-17T22:03:00.000Z',
  )

  const changed = {
    ...result,
    receipts: [{
      ...result.receipts[0],
      accountingHash: '0'.repeat(64),
    }, result.receipts[1]],
  }
  await assert.rejects(
    persistVerifiedRecoveryAccountingDispatchResult(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      changed,
      '2026-07-17T22:03:00.000Z',
    ),
    RecoveryAccountingDispatchStoreConflictError,
  )
})

test('partial dispatch evidence persists the completed prefix only', async () => {
  const database = await configuredDatabase()
  const approved = await loadVerifiedApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
  )
  const partial = await executeVerifiedRecoveryAccountingPackage(
    'dispatch-partial',
    approved,
    {
      serializer: new FillAccountingSerialQueue(),
      async executeAccountingCommand(command) {
        if (command.fill.fillId === 'fill-2') throw new Error('expected failure')
        return accountingResult(command.fill.fillId)
      },
    },
  )
  const projected = await persistVerifiedRecoveryAccountingDispatchResult(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    partial,
    '2026-07-17T22:03:00.000Z',
  )

  assert.equal(projected.status, 'PARTIAL')
  assert.equal(projected.completedCommandCount, 1)
  assert.equal(database.receipts.length, 1)
  assert.equal(database.dispatch?.automatically_retried, 0)
})

test('denied approval blocks persistence before a dispatch batch', async () => {
  const database = await configuredDatabase()
  database.approval = { ...database.approval, decision: 'DENIED' }
  const result = await completedDispatch(await configuredDatabase())

  await assert.rejects(
    persistVerifiedRecoveryAccountingDispatchResult(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      result,
      '2026-07-17T22:03:00.000Z',
    ),
    RecoveryAccountingDispatchNotApprovedError,
  )
  assert.equal(database.batchCount, 0)
})

test('stored dispatch or receipt capability corruption is rejected on replay', async () => {
  const database = await configuredDatabase()
  const result = await completedDispatch(database)
  await persistVerifiedRecoveryAccountingDispatchResult(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    result,
    '2026-07-17T22:03:00.000Z',
  )
  assert.ok(database.dispatch)
  database.dispatch.execution_allowed = 1

  await assert.rejects(
    persistVerifiedRecoveryAccountingDispatchResult(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      result,
      '2026-07-17T22:03:00.000Z',
    ),
    /permanent capability locks/,
  )

  database.dispatch.execution_allowed = 0
  database.receipts[0].provider_mutation_allowed = 1
  await assert.rejects(
    persistVerifiedRecoveryAccountingDispatchResult(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      result,
      '2026-07-17T22:03:00.000Z',
    ),
    /capability locks/,
  )
})
