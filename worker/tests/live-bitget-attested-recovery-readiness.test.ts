import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateAndPersistBitgetAttestedRecoveryReadiness,
  BitgetAttestedRecoveryReadinessConflictError,
  type BitgetAttestedRecoveryReadinessEnv,
} from '../src/live/bitget-attested-recovery-readiness.ts'

type Row = Record<string, unknown>

class FakeStatement {
  readonly database: FakeD1
  readonly sql: string
  readonly params: unknown[]

  constructor(database: FakeD1, sql: string, params: unknown[] = []) {
    this.database = database
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.database, this.sql, params) as unknown as D1PreparedStatement
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql, this.params) as T | null)
  }

  all<T>(): Promise<D1Result<T>> {
    return Promise.resolve({ results: this.database.all(this.sql, this.params) } as D1Result<T>)
  }
}

class FakeD1 {
  bindingRow: Row = {
    binding_id: 'binding-1',
    binding_hash: 'a'.repeat(64),
    attestation_id: 'attestation-1',
    ingestion_id: 'ingestion-1',
    snapshot_hash: 'b'.repeat(64),
    exchange_account_id: 'bitget-account-ref',
    product_id: 'BTC-USDT',
    source_mode: 'ISOLATED_READ_ONLY_CLIENT',
    external_read_only_evidence: 1,
    accounting_task_count: 1,
    linked_at: '2026-07-18T02:00:00.000Z',
    automatic_accounting_dispatch_allowed: 0,
    reservation_settlement_allowed: 0,
    certification_check_projection_allowed: 0,
    certified_for_live: 0,
    provider_mutation_allowed: 0,
    automatic_retry_allowed: 0,
    transfer_allowed: 0,
    withdrawal_allowed: 0,
    execution_allowed: 0,
    credentials_persisted: 0,
    reconciliation_required: 1,
    incident_evidence_required: 1,
  }
  ingestionRow: Row = {
    ingestion_id: 'ingestion-1',
    snapshot_hash: 'b'.repeat(64),
    ingestion_hash: 'c'.repeat(64),
    exchange_account_id: 'bitget-account-ref',
    product_id: 'BTC-USDT',
    accounting_task_count: 1,
    complete: 1,
    bounded: 1,
    read_only: 1,
    accounting_applied: 0,
    reservation_settled: 0,
    provider_mutation_allowed: 0,
    execution_allowed: 0,
  }
  taskRows: Row[] = [pendingTask()]
  dispatchRow: Row | null = null
  reconciliationRow: Row | null = null
  checkpoints: Row[] = []
  batchCount = 0
  eventCount = 0

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string, params: unknown[]): unknown {
    if (sql.includes('FROM live_bitget_attested_recovery_ingestions')) {
      return this.bindingRow.binding_id === String(params[0]) ? this.bindingRow : null
    }
    if (sql.includes('FROM live_recovery_ingestions')) {
      return this.ingestionRow.ingestion_id === String(params[0]) ? this.ingestionRow : null
    }
    if (sql.includes('FROM live_recovery_accounting_plans p')) {
      return this.dispatchRow
    }
    if (sql.includes('FROM live_fill_accounting_reconciliations')) {
      return this.reconciliationRow
    }
    if (sql.includes('FROM live_bitget_attested_recovery_readiness')) {
      const checkpointId = String(params[0])
      const bindingId = String(params[1])
      const evaluatedAt = String(params[2])
      return this.checkpoints.find((row) =>
        row.checkpoint_id === checkpointId
        || (row.binding_id === bindingId && row.evaluated_at === evaluatedAt)) ?? null
    }
    return null
  }

  all(sql: string, params: unknown[]): Row[] {
    if (!sql.includes('FROM live_recovery_accounting_task_intents')) return []
    return this.ingestionRow.ingestion_id === String(params[0]) ? this.taskRows.map((row) => ({ ...row })) : []
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    for (const statement of statements as unknown as FakeStatement[]) {
      if (statement.sql.includes('INSERT INTO live_bitget_attested_recovery_readiness (')) {
        const p = statement.params
        this.checkpoints.push({
          checkpoint_id: String(p[0]),
          binding_id: String(p[1]),
          binding_hash: String(p[2]),
          attestation_id: String(p[3]),
          ingestion_id: String(p[4]),
          exchange_account_id: String(p[5]),
          product_id: String(p[6]),
          source_mode: String(p[7]),
          external_read_only_evidence: Number(p[8]),
          status: String(p[9]),
          reasons_json: String(p[10]),
          accounting_task_count: Number(p[11]),
          accounting_receipt_count: Number(p[12]),
          reservation_required_count: Number(p[13]),
          settlement_receipt_count: Number(p[14]),
          dispatch_status: String(p[15]),
          reconciliation_status: String(p[16]),
          latest_accounted_at: p[17] === null ? null : String(p[17]),
          latest_settled_at: p[18] === null ? null : String(p[18]),
          latest_reconciled_at: p[19] === null ? null : String(p[19]),
          oldest_task_at: p[20] === null ? null : String(p[20]),
          evaluated_at: String(p[21]),
          checkpoint_hash: String(p[22]),
          incident_required: Number(p[23]),
          operator_review_required: Number(p[24]),
          automatic_accounting_dispatch_allowed: 0,
          automatic_reservation_settlement_allowed: 0,
          automatic_reconciliation_allowed: 0,
          certification_check_projection_allowed: 0,
          certified_for_live: 0,
          provider_mutation_allowed: 0,
          automatic_retry_allowed: 0,
          transfer_allowed: 0,
          withdrawal_allowed: 0,
          execution_allowed: 0,
          credentials_persisted: 0,
        })
      }
      if (statement.sql.includes('INSERT INTO live_bitget_attested_recovery_readiness_events')) {
        this.eventCount += 1
      }
    }
    return statements.map(() => ({} as D1Result))
  }

  env(): BitgetAttestedRecoveryReadinessEnv {
    return { DB: this as unknown as D1Database }
  }
}

function pendingTask(overrides: Row = {}): Row {
  return {
    fill_id: 'fill-1',
    sequence_timestamp: '2026-07-18T02:00:00.000Z',
    internal_order_id: 'order-1',
    reservation_count: 0,
    accounting_receipt_id: null,
    accounting_hash: null,
    accounted_at: null,
    accounting_provider_mutation_allowed: null,
    accounting_reservation_applied: null,
    accounting_execution_allowed: null,
    settlement_receipt_id: null,
    settlement_hash: null,
    settled_at: null,
    settlement_provider_mutation_allowed: null,
    settlement_execution_allowed: null,
    ...overrides,
  }
}

function accountedTask(overrides: Row = {}): Row {
  return pendingTask({
    accounting_receipt_id: 'accounting-receipt-1',
    accounting_hash: 'd'.repeat(64),
    accounted_at: '2026-07-18T02:04:00.000Z',
    accounting_provider_mutation_allowed: 0,
    accounting_reservation_applied: 0,
    accounting_execution_allowed: 0,
    ...overrides,
  })
}

function settledTask(overrides: Row = {}): Row {
  return accountedTask({
    reservation_count: 1,
    settlement_receipt_id: 'settlement-receipt-1',
    settlement_hash: 'e'.repeat(64),
    settled_at: '2026-07-18T02:06:00.000Z',
    settlement_provider_mutation_allowed: 0,
    settlement_execution_allowed: 0,
    ...overrides,
  })
}

function completedDispatch(overrides: Row = {}): Row {
  return {
    status: 'COMPLETED',
    command_count: 1,
    completed_command_count: 1,
    automatically_dispatched: 0,
    automatically_retried: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
    occurred_at: '2026-07-18T02:05:00.000Z',
    ...overrides,
  }
}

function clearReconciliation(overrides: Row = {}): Row {
  return {
    status: 'CLEAR',
    reasons_json: '[]',
    reconciliation_hash: 'f'.repeat(64),
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
    observed_at: '2026-07-18T02:07:00.000Z',
    ...overrides,
  }
}

async function evaluate(
  database: FakeD1,
  checkpointId: string,
  evaluatedAt = '2026-07-18T02:10:00.000Z',
) {
  return evaluateAndPersistBitgetAttestedRecoveryReadiness(database.env(), {
    checkpointId,
    bindingId: 'binding-1',
    evaluatedAt,
  })
}

test('missing accounting evidence remains pending operator review without automatic dispatch', async () => {
  const database = new FakeD1()
  const result = await evaluate(database, 'checkpoint-pending-accounting')

  assert.equal(result.status, 'PENDING_ACCOUNTING_REVIEW')
  assert.deepEqual(result.reasons, ['accounting_review_required'])
  assert.equal(result.accountingReceiptCount, 0)
  assert.equal(result.dispatchStatus, 'NOT_STARTED')
  assert.equal(result.incidentRequired, false)
  assert.equal(result.operatorReviewRequired, true)
  assert.equal(result.automaticAccountingDispatchAllowed, false)
  assert.equal(result.automaticReservationSettlementAllowed, false)
  assert.equal(result.automaticReconciliationAllowed, false)
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.executionAllowed, false)
})

test('a stale pending accounting backlog requires incident evidence', async () => {
  const database = new FakeD1()
  const result = await evaluate(
    database,
    'checkpoint-stale-accounting',
    '2026-07-18T02:20:01.000Z',
  )

  assert.equal(result.status, 'PENDING_ACCOUNTING_REVIEW')
  assert.equal(result.incidentRequired, true)
  assert.deepEqual(result.reasons, [
    'accounting_review_required',
    'attested_recovery_backlog_stale',
  ])
})

test('completed accounting with an unsettled reservation remains pending settlement', async () => {
  const database = new FakeD1()
  database.taskRows = [accountedTask({ reservation_count: 1 })]
  database.dispatchRow = completedDispatch()
  const result = await evaluate(database, 'checkpoint-pending-settlement')

  assert.equal(result.status, 'PENDING_SETTLEMENT')
  assert.equal(result.accountingReceiptCount, 1)
  assert.equal(result.reservationRequiredCount, 1)
  assert.equal(result.settlementReceiptCount, 0)
  assert.deepEqual(result.reasons, ['reservation_settlement_evidence_missing'])
})

test('accounting and settlement require a reconciliation newer than all downstream evidence', async () => {
  const database = new FakeD1()
  database.taskRows = [settledTask()]
  database.dispatchRow = completedDispatch()
  database.reconciliationRow = clearReconciliation({ observed_at: '2026-07-18T02:05:30.000Z' })
  const result = await evaluate(database, 'checkpoint-stale-reconciliation')

  assert.equal(result.status, 'PENDING_RECONCILIATION')
  assert.equal(result.reconciliationStatus, 'CLEAR')
  assert.deepEqual(result.reasons, ['reconciliation_evidence_missing_or_stale'])
})

test('fresh clear reconciliation produces a non-live clear checkpoint', async () => {
  const database = new FakeD1()
  database.taskRows = [settledTask()]
  database.dispatchRow = completedDispatch()
  database.reconciliationRow = clearReconciliation()
  const result = await evaluate(database, 'checkpoint-clear')

  assert.equal(result.status, 'CLEAR')
  assert.deepEqual(result.reasons, [])
  assert.equal(result.accountingReceiptCount, 1)
  assert.equal(result.settlementReceiptCount, 1)
  assert.equal(result.dispatchStatus, 'COMPLETED')
  assert.equal(result.reconciliationStatus, 'CLEAR')
  assert.equal(result.incidentRequired, false)
  assert.equal(result.operatorReviewRequired, false)
  assert.equal(result.certificationCheckProjectionAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
  assert.equal(result.credentialsPersisted, false)
  assert.match(result.checkpointHash, /^[a-f0-9]{64}$/)
})

test('partial or failed dispatch and reconciliation mismatches halt for review', async () => {
  const partial = new FakeD1()
  partial.taskRows = [accountedTask()]
  partial.dispatchRow = completedDispatch({
    status: 'PARTIAL',
    completed_command_count: 0,
  })
  const partialResult = await evaluate(partial, 'checkpoint-partial-dispatch')
  assert.equal(partialResult.status, 'HALT_FOR_REVIEW')
  assert.equal(partialResult.incidentRequired, true)
  assert.deepEqual(partialResult.reasons, ['accounting_dispatch_partial'])

  const reconciliation = new FakeD1()
  reconciliation.taskRows = [settledTask()]
  reconciliation.dispatchRow = completedDispatch()
  reconciliation.reconciliationRow = clearReconciliation({
    status: 'HALT_FOR_REVIEW',
    reasons_json: '["ledger_quantity_mismatch"]',
  })
  const reconciliationResult = await evaluate(reconciliation, 'checkpoint-reconciliation-halt')
  assert.equal(reconciliationResult.status, 'HALT_FOR_REVIEW')
  assert.deepEqual(reconciliationResult.reasons, [
    'ledger_quantity_mismatch',
    'reconciliation_halt',
  ])
})

test('multiple reservations and orphan settlements remain visible as incidents', async () => {
  const multiple = new FakeD1()
  multiple.taskRows = [accountedTask({ reservation_count: 2 })]
  multiple.dispatchRow = completedDispatch()
  const multipleResult = await evaluate(multiple, 'checkpoint-multiple-reservations')
  assert.equal(multipleResult.status, 'HALT_FOR_REVIEW')
  assert.deepEqual(multipleResult.reasons, ['multiple_reservations:fill-1'])

  const orphan = new FakeD1()
  orphan.taskRows = [settledTask({ reservation_count: 0 })]
  orphan.dispatchRow = completedDispatch()
  orphan.reconciliationRow = clearReconciliation()
  const orphanResult = await evaluate(orphan, 'checkpoint-orphan-settlement')
  assert.equal(orphanResult.status, 'HALT_FOR_REVIEW')
  assert.equal(orphanResult.settlementReceiptCount, 1)
  assert.equal(orphanResult.reservationRequiredCount, 0)
  assert.deepEqual(orphanResult.reasons, ['orphan_settlement:fill-1'])
})

test('identical checkpoints replay and changed evidence under the same identity conflicts', async () => {
  const database = new FakeD1()
  const first = await evaluate(database, 'checkpoint-replay')
  const replay = await evaluate(database, 'checkpoint-replay')

  assert.equal(first.persistenceStatus, 'PROJECTED')
  assert.equal(replay.persistenceStatus, 'REPLAYED')
  assert.equal(database.batchCount, 1)
  assert.equal(database.eventCount, 1)

  database.taskRows = [accountedTask()]
  database.dispatchRow = completedDispatch()
  await assert.rejects(
    evaluate(database, 'checkpoint-replay'),
    BitgetAttestedRecoveryReadinessConflictError,
  )
})

test('corrupted binding, accounting, settlement, dispatch, and reconciliation locks fail closed', async () => {
  const binding = new FakeD1()
  binding.bindingRow.execution_allowed = 1
  await assert.rejects(
    evaluate(binding, 'checkpoint-binding-lock'),
    /binding violates permanent capability locks/,
  )

  const accounting = new FakeD1()
  accounting.taskRows = [accountedTask({ accounting_provider_mutation_allowed: 1 })]
  await assert.rejects(
    evaluate(accounting, 'checkpoint-accounting-lock'),
    /accounting receipt violates immutable capability locks/,
  )

  const settlement = new FakeD1()
  settlement.taskRows = [settledTask({ settlement_execution_allowed: 1 })]
  settlement.dispatchRow = completedDispatch()
  await assert.rejects(
    evaluate(settlement, 'checkpoint-settlement-lock'),
    /settlement receipt violates immutable capability locks/,
  )

  const dispatch = new FakeD1()
  dispatch.taskRows = [accountedTask()]
  dispatch.dispatchRow = completedDispatch({ automatically_retried: 1 })
  await assert.rejects(
    evaluate(dispatch, 'checkpoint-dispatch-lock'),
    /dispatch violates permanent capability locks/,
  )

  const reconciliation = new FakeD1()
  reconciliation.taskRows = [settledTask()]
  reconciliation.dispatchRow = completedDispatch()
  reconciliation.reconciliationRow = clearReconciliation({ provider_mutation_allowed: 1 })
  await assert.rejects(
    evaluate(reconciliation, 'checkpoint-reconciliation-lock'),
    /reconciliation evidence violates permanent capability locks/,
  )
})
