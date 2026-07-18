import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash, canonicalJson } from '../src/live/canonical-json.ts'
import {
  projectBitgetAttestedRecoveryReadinessObservability,
  BitgetAttestedRecoveryReadinessObservabilityConflictError,
} from '../src/live/bitget-attested-recovery-readiness-observability.ts'
import {
  openOrRefreshAlert,
  recordMetricSample,
  resolveAlert,
  type ObservabilityEnv,
} from '../src/live/observability-store.ts'

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
}

class FakeD1 {
  row: Row | null

  constructor(row: Row) {
    this.row = row
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string, params: unknown[]): unknown {
    if (!sql.includes('FROM live_bitget_attested_recovery_readiness')) return null
    return this.row?.checkpoint_id === String(params[0]) ? this.row : null
  }

  env(): ObservabilityEnv {
    return { DB: this as unknown as D1Database }
  }
}

interface CheckpointOptions {
  checkpointId?: string
  status?: 'PENDING_ACCOUNTING_REVIEW' | 'PENDING_SETTLEMENT' | 'PENDING_RECONCILIATION' | 'CLEAR' | 'HALT_FOR_REVIEW'
  reasons?: readonly string[]
  incidentRequired?: boolean
  operatorReviewRequired?: boolean
  accountingTaskCount?: number
  accountingReceiptCount?: number
  reservationRequiredCount?: number
  settlementReceiptCount?: number
  dispatchStatus?: 'NOT_STARTED' | 'COMPLETED' | 'PARTIAL' | 'FAILED'
  reconciliationStatus?: 'NOT_RUN' | 'CLEAR' | 'HALT_FOR_REVIEW'
  latestAccountedAt?: string | null
  latestSettledAt?: string | null
  latestReconciledAt?: string | null
  oldestTaskAt?: string | null
  evaluatedAt?: string
}

async function checkpointRow(options: CheckpointOptions = {}): Promise<Row> {
  const checkpointId = options.checkpointId ?? 'checkpoint-1'
  const status = options.status ?? 'PENDING_ACCOUNTING_REVIEW'
  const reasons = Object.freeze([...(options.reasons ?? ['accounting_review_required'])].sort())
  const incidentRequired = options.incidentRequired ?? false
  const operatorReviewRequired = options.operatorReviewRequired ?? status !== 'CLEAR'
  const evidence = {
    checkpointId,
    bindingId: 'binding-1',
    bindingHash: 'a'.repeat(64),
    attestationId: 'attestation-1',
    ingestionId: 'ingestion-1',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    sourceMode: 'ISOLATED_READ_ONLY_CLIENT' as const,
    externalReadOnlyEvidence: true,
    status,
    reasons,
    accountingTaskCount: options.accountingTaskCount ?? 1,
    accountingReceiptCount: options.accountingReceiptCount ?? 0,
    reservationRequiredCount: options.reservationRequiredCount ?? 0,
    settlementReceiptCount: options.settlementReceiptCount ?? 0,
    dispatchStatus: options.dispatchStatus ?? 'NOT_STARTED',
    reconciliationStatus: options.reconciliationStatus ?? 'NOT_RUN',
    latestAccountedAt: options.latestAccountedAt ?? null,
    latestSettledAt: options.latestSettledAt ?? null,
    latestReconciledAt: options.latestReconciledAt ?? null,
    oldestTaskAt: options.oldestTaskAt ?? '2026-07-18T02:00:00.000Z',
    evaluatedAt: options.evaluatedAt ?? '2026-07-18T02:10:00.000Z',
    incidentRequired,
    operatorReviewRequired,
    automaticAccountingDispatchAllowed: false,
    automaticReservationSettlementAllowed: false,
    automaticReconciliationAllowed: false,
    certificationCheckProjectionAllowed: false,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  }
  const checkpointHash = await canonicalHash(evidence)
  return {
    checkpoint_id: checkpointId,
    binding_id: evidence.bindingId,
    binding_hash: evidence.bindingHash,
    attestation_id: evidence.attestationId,
    ingestion_id: evidence.ingestionId,
    exchange_account_id: evidence.exchangeAccountId,
    product_id: evidence.productId,
    source_mode: evidence.sourceMode,
    external_read_only_evidence: 1,
    status,
    reasons_json: canonicalJson(reasons),
    accounting_task_count: evidence.accountingTaskCount,
    accounting_receipt_count: evidence.accountingReceiptCount,
    reservation_required_count: evidence.reservationRequiredCount,
    settlement_receipt_count: evidence.settlementReceiptCount,
    dispatch_status: evidence.dispatchStatus,
    reconciliation_status: evidence.reconciliationStatus,
    latest_accounted_at: evidence.latestAccountedAt,
    latest_settled_at: evidence.latestSettledAt,
    latest_reconciled_at: evidence.latestReconciledAt,
    oldest_task_at: evidence.oldestTaskAt,
    evaluated_at: evidence.evaluatedAt,
    checkpoint_hash: checkpointHash,
    incident_required: incidentRequired ? 1 : 0,
    operator_review_required: operatorReviewRequired ? 1 : 0,
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
  }
}

function dependencies() {
  const metrics: Parameters<typeof recordMetricSample>[1][] = []
  const opened: Parameters<typeof openOrRefreshAlert>[1][] = []
  const resolved: Parameters<typeof resolveAlert>[1][] = []
  let resolveResult = true

  const recordMetric: typeof recordMetricSample = async (_env, input) => {
    metrics.push(input)
  }
  const openAlert: typeof openOrRefreshAlert = async (_env, input) => {
    opened.push(input)
  }
  const resolve: typeof resolveAlert = async (_env, input) => {
    resolved.push(input)
    return resolveResult
  }

  return {
    metrics,
    opened,
    resolved,
    setResolveResult(value: boolean) {
      resolveResult = value
    },
    functions: { recordMetric, openAlert, resolveAlert: resolve },
  }
}

const request = {
  checkpointId: 'checkpoint-1',
  correlationId: 'correlation-1',
  auditEventHash: 'b'.repeat(64),
}

test('stale pending readiness opens a deduplicated warning and emits a metric', async () => {
  const row = await checkpointRow({
    reasons: ['accounting_review_required', 'attested_recovery_backlog_stale'],
    incidentRequired: true,
    evaluatedAt: '2026-07-18T02:20:01.000Z',
  })
  const database = new FakeD1(row)
  const captured = dependencies()
  const result = await projectBitgetAttestedRecoveryReadinessObservability(
    database.env(),
    request,
    captured.functions,
  )

  assert.equal(result.action, 'OPENED_OR_REFRESHED')
  assert.equal(result.incidentRequired, true)
  assert.equal(result.guardianMutationAllowed, false)
  assert.equal(result.automaticAccountingDispatchAllowed, false)
  assert.equal(result.automaticReservationSettlementAllowed, false)
  assert.equal(result.automaticReconciliationAllowed, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(captured.metrics.length, 1)
  assert.equal(captured.metrics[0]?.metricName, 'bitget_attested_recovery_readiness_status')
  assert.equal(captured.opened.length, 1)
  assert.equal(captured.opened[0]?.alert.severity, 'WARNING')
  assert.equal(captured.opened[0]?.alert.guardianAction, 'RESTRICT_ACCOUNT')
  assert.equal(captured.opened[0]?.alert.reasonCode, 'BITGET_ATTESTED_RECOVERY_BACKLOG_STALE')
  assert.equal(captured.resolved.length, 0)
})

test('halt-for-review opens a critical account-halt recommendation without mutating Guardian', async () => {
  const row = await checkpointRow({
    status: 'HALT_FOR_REVIEW',
    reasons: ['accounting_dispatch_partial'],
    incidentRequired: true,
    operatorReviewRequired: true,
    dispatchStatus: 'PARTIAL',
  })
  const captured = dependencies()
  const result = await projectBitgetAttestedRecoveryReadinessObservability(
    new FakeD1(row).env(),
    request,
    captured.functions,
  )

  assert.equal(result.action, 'OPENED_OR_REFRESHED')
  assert.equal(captured.opened[0]?.alert.severity, 'CRITICAL')
  assert.equal(captured.opened[0]?.alert.guardianAction, 'HALT_ACCOUNT')
  assert.equal(captured.opened[0]?.alert.reasonCode, 'BITGET_ATTESTED_RECOVERY_HALTED')
  assert.equal(result.guardianMutationAllowed, false)
})

test('clear readiness resolves the stable alert identity and remains non-live', async () => {
  const row = await checkpointRow({
    status: 'CLEAR',
    reasons: [],
    incidentRequired: false,
    operatorReviewRequired: false,
    accountingReceiptCount: 1,
    reservationRequiredCount: 1,
    settlementReceiptCount: 1,
    dispatchStatus: 'COMPLETED',
    reconciliationStatus: 'CLEAR',
    latestAccountedAt: '2026-07-18T02:04:00.000Z',
    latestSettledAt: '2026-07-18T02:06:00.000Z',
    latestReconciledAt: '2026-07-18T02:07:00.000Z',
  })
  const captured = dependencies()
  const result = await projectBitgetAttestedRecoveryReadinessObservability(
    new FakeD1(row).env(),
    request,
    captured.functions,
  )

  assert.equal(result.action, 'RESOLVED')
  assert.equal(captured.opened.length, 0)
  assert.equal(captured.resolved.length, 1)
  assert.equal(captured.resolved[0]?.reasonCode, 'BITGET_ATTESTED_RECOVERY_CLEAR')
  assert.equal(captured.resolved[0]?.actorId, null)
  assert.equal(result.executionAllowed, false)
})

test('fresh pending readiness emits a metric but neither opens nor resolves an alert', async () => {
  const row = await checkpointRow()
  const captured = dependencies()
  const result = await projectBitgetAttestedRecoveryReadinessObservability(
    new FakeD1(row).env(),
    request,
    captured.functions,
  )

  assert.equal(result.action, 'NO_ACTION')
  assert.equal(captured.metrics.length, 1)
  assert.equal(captured.opened.length, 0)
  assert.equal(captured.resolved.length, 0)
})

test('stable checkpoint evidence produces stable metric and alert event identities', async () => {
  const row = await checkpointRow({
    reasons: ['accounting_review_required', 'attested_recovery_backlog_stale'],
    incidentRequired: true,
  })
  const first = dependencies()
  const second = dependencies()
  await projectBitgetAttestedRecoveryReadinessObservability(
    new FakeD1(row).env(),
    request,
    first.functions,
  )
  await projectBitgetAttestedRecoveryReadinessObservability(
    new FakeD1(row).env(),
    request,
    second.functions,
  )

  assert.equal(first.metrics[0]?.metricSampleId, second.metrics[0]?.metricSampleId)
  assert.equal(first.opened[0]?.alertEventId, second.opened[0]?.alertEventId)
  assert.equal(first.opened[0]?.alertId, second.opened[0]?.alertId)
  assert.equal(first.opened[0]?.alert.alertKey, second.opened[0]?.alert.alertKey)
})

test('missing prior alert leaves a clear checkpoint as a safe no-op', async () => {
  const row = await checkpointRow({
    status: 'CLEAR',
    reasons: [],
    incidentRequired: false,
    operatorReviewRequired: false,
    accountingReceiptCount: 1,
    dispatchStatus: 'COMPLETED',
    reconciliationStatus: 'CLEAR',
  })
  const captured = dependencies()
  captured.setResolveResult(false)
  const result = await projectBitgetAttestedRecoveryReadinessObservability(
    new FakeD1(row).env(),
    request,
    captured.functions,
  )
  assert.equal(result.action, 'NO_ACTION')
})

test('tampered hashes, noncanonical reasons, inconsistent status, and capability corruption fail closed', async () => {
  const hash = await checkpointRow()
  hash.checkpoint_hash = 'f'.repeat(64)
  await assert.rejects(
    projectBitgetAttestedRecoveryReadinessObservability(
      new FakeD1(hash).env(), request, dependencies().functions,
    ),
    /checkpoint hash is invalid/,
  )

  const reasons = await checkpointRow()
  reasons.reasons_json = '["z","a"]'
  await assert.rejects(
    projectBitgetAttestedRecoveryReadinessObservability(
      new FakeD1(reasons).env(), request, dependencies().functions,
    ),
    /reasons JSON is not canonical/,
  )

  const status = await checkpointRow({
    status: 'CLEAR',
    reasons: [],
    incidentRequired: true,
    operatorReviewRequired: false,
  })
  await assert.rejects(
    projectBitgetAttestedRecoveryReadinessObservability(
      new FakeD1(status).env(), request, dependencies().functions,
    ),
    /status conflicts with incident/,
  )

  const locks = await checkpointRow()
  locks.execution_allowed = 1
  await assert.rejects(
    projectBitgetAttestedRecoveryReadinessObservability(
      new FakeD1(locks).env(), request, dependencies().functions,
    ),
    BitgetAttestedRecoveryReadinessObservabilityConflictError,
  )
})
