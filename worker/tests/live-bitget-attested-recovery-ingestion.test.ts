import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash } from '../src/live/canonical-json.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import {
  persistAttestedBitgetRecoveryIngestion,
  BitgetAttestedRecoveryIngestionConflictError,
  type BitgetAttestedRecoveryIngestionEnv,
} from '../src/live/bitget-attested-recovery-ingestion.ts'
import {
  buildBitgetRecoveryIngestionPlan,
  type BitgetRecoveryIngestionInput,
  type BitgetRecoveryIngestionPlan,
} from '../src/live/recovery-ingestion.ts'
import type { PersistRecoveryIngestionResult } from '../src/live/recovery-ingestion-store.ts'

type SourceMode = 'INJECTED_FIXTURES' | 'ISOLATED_READ_ONLY_CLIENT'
type Environment = 'LOCAL_TEST' | 'SHADOW'
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
  packageRow: Row
  checkRows: Row[]
  binding: Row | null = null
  batchCount = 0
  eventCount = 0

  constructor(packageRow: Row, checkRows: Row[]) {
    this.packageRow = packageRow
    this.checkRows = checkRows
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string, params: unknown[]): unknown {
    if (sql.includes('FROM live_bitget_read_only_certification_attestations a')) {
      return this.packageRow.attestation_id === String(params[0]) ? this.packageRow : null
    }
    if (sql.includes('FROM live_bitget_attested_recovery_ingestions')) {
      if (!this.binding) return null
      const bindingId = String(params[0])
      const ingestionId = String(params[1])
      const attestationId = String(params[2])
      return this.binding.binding_id === bindingId
        || this.binding.ingestion_id === ingestionId
        || (this.binding.attestation_id === attestationId && this.binding.ingestion_id === String(params[3]))
        ? this.binding
        : null
    }
    return null
  }

  all(sql: string, params: unknown[]): Row[] {
    if (!sql.includes('FROM live_bitget_read_only_certification_checks')) return []
    return this.packageRow.certification_run_id === String(params[0]) ? [...this.checkRows] : []
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    for (const statement of statements as unknown as FakeStatement[]) {
      if (statement.sql.includes('INSERT INTO live_bitget_attested_recovery_ingestions')) {
        const p = statement.params
        this.binding = {
          binding_id: String(p[0]),
          attestation_id: String(p[1]),
          certification_run_id: String(p[2]),
          run_evidence_hash: String(p[3]),
          attestation_hash: String(p[4]),
          source_mode: String(p[5]),
          certification_environment: String(p[6]),
          external_read_only_evidence: Number(p[7]),
          ingestion_id: String(p[8]),
          snapshot_id: String(p[9]),
          snapshot_hash: String(p[10]),
          ingestion_hash: String(p[11]),
          exchange_account_id: String(p[12]),
          product_id: String(p[13]),
          accounting_task_count: Number(p[14]),
          linked_at: String(p[15]),
          binding_hash: String(p[16]),
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
      }
      if (statement.sql.includes('INSERT INTO live_bitget_attested_recovery_ingestion_events')) {
        this.eventCount += 1
      }
    }
    return statements.map(() => ({} as D1Result))
  }

  env(): BitgetAttestedRecoveryIngestionEnv {
    return { DB: this as unknown as D1Database }
  }
}

function recoveryInput(
  overrides: Partial<BitgetRecoveryIngestionInput> = {},
): BitgetRecoveryIngestionInput {
  return {
    ingestionId: 'recovery-ingestion-attested-1',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoveredAt: '2026-07-18T02:00:00.000Z',
    recovery: {
      snapshot: {
        orders: [{
          exchangeOrderId: 'order-1',
          clientOrderId: 'client-1',
          productId: 'BTC-USDT',
          side: 'BUY',
          orderType: 'LIMIT',
          rawStatus: 'filled',
          requestedBaseQuantity: asDecimalString('0.01'),
          requestedQuoteNotional: null,
          filledBaseQuantity: asDecimalString('0.01'),
          filledQuoteValue: asDecimalString('500'),
          remainingBaseQuantity: asDecimalString('0'),
          averageFillPrice: asDecimalString('50000'),
          totalFees: asDecimalString('0.5'),
          pendingCancel: false,
          settled: true,
          createdAt: '2026-07-18T01:30:00.000Z',
          updatedAt: '2026-07-18T01:40:00.000Z',
        }],
        fills: [{
          fillId: 'fill-1',
          tradeId: 'trade-1',
          exchangeOrderId: 'order-1',
          productId: 'BTC-USDT',
          side: 'BUY',
          price: asDecimalString('50000'),
          baseSize: asDecimalString('0.01'),
          commission: asDecimalString('0.5'),
          commissionAsset: 'USDT',
          tradeTime: '2026-07-18T01:40:00.000Z',
          sequenceTimestamp: '2026-07-18T01:40:00.100Z',
        }],
        snapshotAt: '2026-07-18T01:59:59.000Z',
        serverTimestampMs: 1784339999000,
      },
      cursor: {
        connected: true,
        initialized: true,
        ordersSubscribed: true,
        fillsSubscribed: true,
        lastMessageAt: '2026-07-18T01:59:59.000Z',
        lastPongAt: null,
        lastServerTimestampMs: 1784339999000,
        lastRestSnapshotAt: '2026-07-18T01:59:59.000Z',
        recentFingerprints: [],
        recoveryRequired: false,
        recoveryReason: null,
      },
      snapshotHash: 'c'.repeat(64),
      windowStartMs: 1784338200000,
      windowEndMs: 1784340000000,
      currentOrderCount: 0,
      historicalOrderCount: 1,
      fillCount: 1,
      readOnly: true,
      providerMutationAllowed: false,
      executionAllowed: false,
    },
    ...overrides,
  }
}

async function attestationDatabase(
  sourceMode: SourceMode = 'INJECTED_FIXTURES',
): Promise<FakeD1> {
  const environment: Environment = sourceMode === 'INJECTED_FIXTURES' ? 'LOCAL_TEST' : 'SHADOW'
  const external = sourceMode === 'ISOLATED_READ_ONLY_CLIENT'
  const operatorActorId = external ? 'eligible-operator-1' : null
  const authorizationEventHash = external ? 'b'.repeat(64) : null
  const packageRow: Row = {
    attestation_id: `attestation-${sourceMode.toLowerCase()}`,
    certification_run_id: 'read-cert-run-1',
    run_evidence_hash: 'a'.repeat(64),
    run_exchange_account_id: 'bitget-account-ref',
    run_product_id: 'BTC-USDT',
    run_status: 'PASSED',
    run_read_only_evidence_complete: 1,
    run_permissions_verified: 1,
    source_mode: sourceMode,
    certification_environment: environment,
    source_ref: external ? 'isolated-run:bitget-read-only:001' : 'circleci:fixture-run',
    operator_actor_id: operatorActorId,
    authorization_event_hash: authorizationEventHash,
    attested_at: '2026-07-18T01:55:00.000Z',
    external_read_only_evidence: external ? 1 : 0,
    run_certified_for_live: 0,
    run_provider_mutation_allowed: 0,
    run_automatic_retry_allowed: 0,
    run_transfer_allowed: 0,
    run_withdrawal_allowed: 0,
    run_execution_allowed: 0,
    run_credentials_persisted: 0,
    attestation_certification_check_projection_allowed: 0,
    attestation_certified_for_live: 0,
    attestation_provider_mutation_allowed: 0,
    attestation_automatic_retry_allowed: 0,
    attestation_transfer_allowed: 0,
    attestation_withdrawal_allowed: 0,
    attestation_execution_allowed: 0,
    attestation_credentials_persisted: 0,
  }
  packageRow.attestation_hash = await canonicalHash({
    attestationId: packageRow.attestation_id,
    runId: packageRow.certification_run_id,
    runEvidenceHash: packageRow.run_evidence_hash,
    sourceMode,
    environment,
    sourceRef: packageRow.source_ref,
    operatorActorId,
    authorizationEventHash,
    attestedAt: packageRow.attested_at,
    externalReadOnlyEvidence: external,
    certificationCheckProjectionAllowed: false,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  })
  const checks = [
    'READ_ONLY_PERMISSIONS',
    'PRODUCT_CONTRACT',
    'BALANCE_CONTRACT',
    'CURRENT_ORDER_CONTRACT',
    'ORDER_HISTORY_CONTRACT',
    'FILL_CONTRACT',
    'PAGINATION_BOUNDARY',
    'RECOVERY_IDENTITY_CONSISTENCY',
  ].map((check_name, index) => ({
    check_name,
    status: 'PASS',
    evidence_hash: String(index + 1).padStart(64, '0'),
  }))
  return new FakeD1(packageRow, checks)
}

function ingestionResult(plan: BitgetRecoveryIngestionPlan): PersistRecoveryIngestionResult {
  return {
    status: 'INGESTED',
    ingestionId: plan.ingestionId,
    snapshotId: plan.snapshotId,
    snapshotHash: plan.snapshotHash,
    ingestionHash: plan.ingestionHash,
    orderCount: plan.orderObservations.length,
    fillCount: plan.fillObservations.length,
    accountingTaskCount: plan.accountingTaskIntents.length,
    newFillCount: plan.fillObservations.length,
    newAccountingTaskCount: plan.accountingTaskIntents.length,
    accountingApplied: false,
    reservationSettled: false,
    providerMutationAllowed: false,
    executionAllowed: false,
  }
}

test('fixture certification binds only local non-external recovery evidence', async () => {
  const database = await attestationDatabase('INJECTED_FIXTURES')
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  let persistCount = 0
  const result = await persistAttestedBitgetRecoveryIngestion(database.env(), {
    bindingId: 'binding-fixture-1',
    attestationId: String(database.packageRow.attestation_id),
    linkedAt: '2026-07-18T02:01:00.000Z',
    plan,
  }, {
    persistIngestion: async () => {
      persistCount += 1
      return ingestionResult(plan)
    },
  })

  assert.equal(result.persistenceStatus, 'BOUND')
  assert.equal(result.ingestionPersistenceStatus, 'INGESTED')
  assert.equal(result.sourceMode, 'INJECTED_FIXTURES')
  assert.equal(result.certificationEnvironment, 'LOCAL_TEST')
  assert.equal(result.externalReadOnlyEvidence, false)
  assert.equal(result.automaticAccountingDispatchAllowed, false)
  assert.equal(result.reservationSettlementAllowed, false)
  assert.equal(result.certificationCheckProjectionAllowed, false)
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(result.reconciliationRequired, true)
  assert.equal(result.incidentEvidenceRequired, true)
  assert.equal(persistCount, 1)
  assert.equal(database.batchCount, 1)
  assert.equal(database.eventCount, 1)
})

test('authorized isolated certification binds external read-only recovery evidence without dispatch', async () => {
  const database = await attestationDatabase('ISOLATED_READ_ONLY_CLIENT')
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  const result = await persistAttestedBitgetRecoveryIngestion(database.env(), {
    bindingId: 'binding-isolated-1',
    attestationId: String(database.packageRow.attestation_id),
    linkedAt: '2026-07-18T02:01:00.000Z',
    plan,
  }, { persistIngestion: async () => ingestionResult(plan) })

  assert.equal(result.sourceMode, 'ISOLATED_READ_ONLY_CLIENT')
  assert.equal(result.certificationEnvironment, 'SHADOW')
  assert.equal(result.externalReadOnlyEvidence, true)
  assert.equal(result.credentialsPersisted, false)
  assert.equal(result.transferAllowed, false)
  assert.equal(result.withdrawalAllowed, false)
  assert.match(result.bindingHash, /^[a-f0-9]{64}$/)
})

test('identical binding replays without persisting ingestion or another event', async () => {
  const database = await attestationDatabase()
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  let persistCount = 0
  const input = {
    bindingId: 'binding-replay-1',
    attestationId: String(database.packageRow.attestation_id),
    linkedAt: '2026-07-18T02:01:00.000Z',
    plan,
  }
  const dependencies = {
    persistIngestion: async () => {
      persistCount += 1
      return ingestionResult(plan)
    },
  }
  await persistAttestedBitgetRecoveryIngestion(database.env(), input, dependencies)
  const replay = await persistAttestedBitgetRecoveryIngestion(database.env(), input, dependencies)

  assert.equal(replay.persistenceStatus, 'REPLAYED')
  assert.equal(persistCount, 1)
  assert.equal(database.batchCount, 1)
  assert.equal(database.eventCount, 1)
})

test('certification account and product must match the recovery plan', async () => {
  const database = await attestationDatabase()
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  database.packageRow.run_exchange_account_id = 'different-account'
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-mismatch-1',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan,
    }, { persistIngestion: async () => ingestionResult(plan) }),
    /account or product does not match/,
  )
})

test('all eight certification checks and capability locks are mandatory', async () => {
  const database = await attestationDatabase('ISOLATED_READ_ONLY_CLIENT')
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  database.checkRows.pop()
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-checks-1',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan,
    }, { persistIngestion: async () => ingestionResult(plan) }),
    /all eight read-only certification checks/,
  )

  database.checkRows.push({
    check_name: 'RECOVERY_IDENTITY_CONSISTENCY',
    status: 'PASS',
    evidence_hash: '8'.repeat(64),
  })
  database.packageRow.attestation_execution_allowed = 1
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-locks-1',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan,
    }, { persistIngestion: async () => ingestionResult(plan) }),
    /permanent capability locks/,
  )
})

test('tampered recovery observations and ingestion hashes fail before persistence', async () => {
  const database = await attestationDatabase()
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  const tamperedFill = {
    ...plan,
    fillObservations: Object.freeze([{
      ...plan.fillObservations[0]!,
      fillJson: JSON.stringify({ tampered: true }),
    }]),
  } as BitgetRecoveryIngestionPlan
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-tampered-fill',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan: tamperedFill,
    }, { persistIngestion: async () => ingestionResult(tamperedFill) }),
    /recovered fill hash is invalid/,
  )

  const tamperedHash = { ...plan, ingestionHash: 'f'.repeat(64) } as BitgetRecoveryIngestionPlan
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-tampered-hash',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan: tamperedHash,
    }, { persistIngestion: async () => ingestionResult(tamperedHash) }),
    /plan hash is invalid/,
  )
})

test('persistence results and binding replays cannot change immutable evidence', async () => {
  const database = await attestationDatabase()
  const plan = await buildBitgetRecoveryIngestionPlan(recoveryInput())
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-result-conflict',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan,
    }, {
      persistIngestion: async () => ({ ...ingestionResult(plan), accountingTaskCount: 99 }),
    }),
    /persistence result conflicts/,
  )

  await persistAttestedBitgetRecoveryIngestion(database.env(), {
    bindingId: 'binding-original',
    attestationId: String(database.packageRow.attestation_id),
    linkedAt: '2026-07-18T02:01:00.000Z',
    plan,
  }, { persistIngestion: async () => ingestionResult(plan) })
  await assert.rejects(
    persistAttestedBitgetRecoveryIngestion(database.env(), {
      bindingId: 'binding-changed',
      attestationId: String(database.packageRow.attestation_id),
      linkedAt: '2026-07-18T02:01:00.000Z',
      plan,
    }, { persistIngestion: async () => ingestionResult(plan) }),
    BitgetAttestedRecoveryIngestionConflictError,
  )
})
