import type { BitgetRecoveryIngestionPlan } from './recovery-ingestion.ts'

export interface RecoveryIngestionStoreEnv {
  DB: D1Database
}

export interface PersistRecoveryIngestionResult {
  status: 'INGESTED' | 'REPLAYED'
  ingestionId: string
  snapshotId: string
  snapshotHash: string
  ingestionHash: string
  orderCount: number
  fillCount: number
  accountingTaskCount: number
  newFillCount: number
  newAccountingTaskCount: number
  accountingApplied: false
  reservationSettled: false
  providerMutationAllowed: false
  executionAllowed: false
}

export class RecoveryIngestionConflictError extends Error {
  readonly code = 'RECOVERY_INGESTION_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryIngestionConflictError'
  }
}

type IngestionRow = {
  ingestion_id: string
  snapshot_id: string
  snapshot_hash: string
  request_hash: string
  ingestion_hash: string
  order_count: number
  fill_count: number
  accounting_task_count: number
  accounting_applied: number
  reservation_settled: number
  provider_mutation_allowed: number
  execution_allowed: number
}

type FillRow = {
  observation_id: string
  fill_hash: string
}

type TaskRow = {
  task_intent_id: string
  fill_hash: string
  status: string
  accounting_applied: number
  reservation_settled: number
  provider_mutation_allowed: number
  execution_allowed: number
}

function assertPlanLocked(plan: BitgetRecoveryIngestionPlan): void {
  if (
    plan.provider !== 'BITGET'
    || plan.complete !== true
    || plan.bounded !== true
    || plan.readOnly !== true
    || plan.accountingApplied !== false
    || plan.reservationSettled !== false
    || plan.providerMutationAllowed !== false
    || plan.executionAllowed !== false
  ) {
    throw new TypeError('recovery ingestion plan violates immutable capability locks')
  }
  if (plan.fillObservations.length !== plan.accountingTaskIntents.length) {
    throw new TypeError('every recovered fill must have one accounting task intent')
  }
}

function replayResult(row: IngestionRow): PersistRecoveryIngestionResult {
  if (
    row.accounting_applied !== 0
    || row.reservation_settled !== 0
    || row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryIngestionConflictError(
      'recovery ingestion receipt violates permanent capability locks',
    )
  }
  return Object.freeze({
    status: 'REPLAYED',
    ingestionId: row.ingestion_id,
    snapshotId: row.snapshot_id,
    snapshotHash: row.snapshot_hash,
    ingestionHash: row.ingestion_hash,
    orderCount: row.order_count,
    fillCount: row.fill_count,
    accountingTaskCount: row.accounting_task_count,
    newFillCount: 0,
    newAccountingTaskCount: 0,
    accountingApplied: false,
    reservationSettled: false,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}

async function existingIngestion(
  env: RecoveryIngestionStoreEnv,
  plan: BitgetRecoveryIngestionPlan,
): Promise<IngestionRow | null> {
  return env.DB.prepare(`
    SELECT ingestion_id, snapshot_id, snapshot_hash, request_hash,
           ingestion_hash, order_count, fill_count, accounting_task_count,
           accounting_applied, reservation_settled,
           provider_mutation_allowed, execution_allowed
      FROM live_recovery_ingestions
     WHERE ingestion_id = ? OR snapshot_id = ? OR snapshot_hash = ?
     LIMIT 1
  `).bind(
    plan.ingestionId,
    plan.snapshotId,
    plan.snapshotHash,
  ).first<IngestionRow>()
}

async function classifyFill(
  env: RecoveryIngestionStoreEnv,
  plan: BitgetRecoveryIngestionPlan,
  fillId: string,
  fillHash: string,
): Promise<'NEW' | 'EXISTING'> {
  const existingFill = await env.DB.prepare(`
    SELECT observation_id, fill_hash
      FROM live_recovery_fill_observations
     WHERE provider = 'BITGET'
       AND exchange_account_id = ?
       AND fill_id = ?
     LIMIT 1
  `).bind(plan.exchangeAccountId, fillId).first<FillRow>()

  const existingTask = await env.DB.prepare(`
    SELECT task_intent_id, fill_hash, status, accounting_applied,
           reservation_settled, provider_mutation_allowed, execution_allowed
      FROM live_recovery_accounting_task_intents
     WHERE provider = 'BITGET'
       AND exchange_account_id = ?
       AND fill_id = ?
     LIMIT 1
  `).bind(plan.exchangeAccountId, fillId).first<TaskRow>()

  if (!existingFill && !existingTask) return 'NEW'
  if (!existingFill || !existingTask) {
    throw new RecoveryIngestionConflictError(
      `recovered fill and accounting task are not paired: ${fillId}`,
    )
  }
  if (existingFill.fill_hash !== fillHash || existingTask.fill_hash !== fillHash) {
    throw new RecoveryIngestionConflictError(`recovered fill hash conflicts: ${fillId}`)
  }
  if (
    existingTask.status !== 'PENDING_ACCOUNTING'
    || existingTask.accounting_applied !== 0
    || existingTask.reservation_settled !== 0
    || existingTask.provider_mutation_allowed !== 0
    || existingTask.execution_allowed !== 0
  ) {
    throw new RecoveryIngestionConflictError(
      `existing accounting task violates immutable pending locks: ${fillId}`,
    )
  }
  return 'EXISTING'
}

export async function persistBitgetRecoveryIngestion(
  env: RecoveryIngestionStoreEnv,
  plan: BitgetRecoveryIngestionPlan,
): Promise<PersistRecoveryIngestionResult> {
  assertPlanLocked(plan)

  const existing = await existingIngestion(env, plan)
  if (existing) {
    if (
      existing.ingestion_id !== plan.ingestionId
      || existing.snapshot_id !== plan.snapshotId
      || existing.snapshot_hash !== plan.snapshotHash
      || existing.request_hash !== plan.requestHash
      || existing.ingestion_hash !== plan.ingestionHash
      || existing.order_count !== plan.orderObservations.length
      || existing.fill_count !== plan.fillObservations.length
      || existing.accounting_task_count !== plan.accountingTaskIntents.length
    ) {
      throw new RecoveryIngestionConflictError(
        'recovery ingestion identity conflicts with existing snapshot evidence',
      )
    }
    return replayResult(existing)
  }

  const newFillIds = new Set<string>()
  for (const fill of plan.fillObservations) {
    const classification = await classifyFill(
      env,
      plan,
      fill.fillId,
      fill.fillHash,
    )
    if (classification === 'NEW') newFillIds.add(fill.fillId)
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO live_recovery_ingestions (
        ingestion_id, provider, exchange_account_id, product_id,
        snapshot_id, snapshot_hash, request_hash, ingestion_hash,
        window_start_ms, window_end_ms, server_timestamp_ms,
        order_count, fill_count, accounting_task_count,
        complete, bounded, read_only, accounting_applied,
        reservation_settled, provider_mutation_allowed, execution_allowed,
        recovered_at
      ) VALUES (?, 'BITGET', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 0, 0, 0, 0, ?)
    `).bind(
      plan.ingestionId,
      plan.exchangeAccountId,
      plan.productId,
      plan.snapshotId,
      plan.snapshotHash,
      plan.requestHash,
      plan.ingestionHash,
      plan.windowStartMs,
      plan.windowEndMs,
      plan.serverTimestampMs,
      plan.orderObservations.length,
      plan.fillObservations.length,
      plan.accountingTaskIntents.length,
      plan.recoveredAt,
    ),
    ...plan.orderObservations.map((order) => env.DB.prepare(`
      INSERT INTO live_recovery_order_observations (
        observation_id, ingestion_id, provider, exchange_account_id,
        product_id, order_identity, order_hash, order_json, observed_at
      ) VALUES (?, ?, 'BITGET', ?, ?, ?, ?, ?, ?)
    `).bind(
      order.observationId,
      plan.ingestionId,
      plan.exchangeAccountId,
      plan.productId,
      order.orderIdentity,
      order.orderHash,
      order.orderJson,
      order.observedAt,
    )),
  ]

  for (const fill of plan.fillObservations) {
    if (!newFillIds.has(fill.fillId)) continue
    statements.push(env.DB.prepare(`
      INSERT INTO live_recovery_fill_observations (
        observation_id, ingestion_id, provider, exchange_account_id,
        product_id, fill_id, fill_hash, fill_json, sequence_timestamp
      ) VALUES (?, ?, 'BITGET', ?, ?, ?, ?, ?, ?)
    `).bind(
      fill.observationId,
      plan.ingestionId,
      plan.exchangeAccountId,
      plan.productId,
      fill.fillId,
      fill.fillHash,
      fill.fillJson,
      fill.sequenceTimestamp,
    ))
  }

  for (const task of plan.accountingTaskIntents) {
    if (!newFillIds.has(task.fillId)) continue
    statements.push(env.DB.prepare(`
      INSERT INTO live_recovery_accounting_task_intents (
        task_intent_id, ingestion_id, provider, exchange_account_id,
        product_id, fill_id, fill_hash, sequence_timestamp, status,
        accounting_applied, reservation_settled,
        provider_mutation_allowed, execution_allowed
      ) VALUES (?, ?, 'BITGET', ?, ?, ?, ?, ?, 'PENDING_ACCOUNTING', 0, 0, 0, 0)
    `).bind(
      task.taskIntentId,
      plan.ingestionId,
      plan.exchangeAccountId,
      plan.productId,
      task.fillId,
      task.fillHash,
      task.sequenceTimestamp,
    ))
  }

  statements.push(env.DB.prepare(`
    INSERT INTO live_recovery_ingestion_events (
      ingestion_event_id, ingestion_id, provider, event_type,
      snapshot_hash, ingestion_hash, occurred_at
    ) VALUES (?, ?, 'BITGET', 'RECOVERY_INGESTED', ?, ?, ?)
  `).bind(
    `recovery-ingestion-event:${plan.ingestionHash.slice(0, 32)}`,
    plan.ingestionId,
    plan.snapshotHash,
    plan.ingestionHash,
    plan.recoveredAt,
  ))

  await env.DB.batch(statements)

  const projected = await existingIngestion(env, plan)
  if (!projected) throw new Error('recovery ingestion receipt is missing after D1 batch')
  if (
    projected.request_hash !== plan.requestHash
    || projected.ingestion_hash !== plan.ingestionHash
    || projected.snapshot_hash !== plan.snapshotHash
  ) {
    throw new RecoveryIngestionConflictError(
      'recovery ingestion receipt hash verification failed',
    )
  }

  return Object.freeze({
    status: 'INGESTED',
    ingestionId: plan.ingestionId,
    snapshotId: plan.snapshotId,
    snapshotHash: plan.snapshotHash,
    ingestionHash: plan.ingestionHash,
    orderCount: plan.orderObservations.length,
    fillCount: plan.fillObservations.length,
    accountingTaskCount: plan.accountingTaskIntents.length,
    newFillCount: newFillIds.size,
    newAccountingTaskCount: newFillIds.size,
    accountingApplied: false,
    reservationSettled: false,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}
