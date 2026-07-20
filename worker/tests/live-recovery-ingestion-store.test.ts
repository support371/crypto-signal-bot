import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import { buildBitgetRecoveryIngestionPlan } from '../src/live/recovery-ingestion.ts'
import {
  persistBitgetRecoveryIngestion,
  RecoveryIngestionConflictError,
} from '../src/live/recovery-ingestion-store.ts'

class FakeStatement {
  private readonly database: FakeDatabase
  readonly sql: string
  readonly params: unknown[]

  constructor(database: FakeDatabase, sql: string, params: unknown[] = []) {
    this.database = database
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.database, this.sql, params) as unknown as D1PreparedStatement
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql) as T | null)
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

class FakeDatabase {
  ingestion: IngestionRow | null = null
  existingFill: { observation_id: string; fill_hash: string } | null = null
  existingTask: {
    task_intent_id: string
    fill_hash: string
    status: string
    accounting_applied: number
    reservation_settled: number
    provider_mutation_allowed: number
    execution_allowed: number
  } | null = null
  readonly batches: FakeStatement[][] = []

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string): unknown {
    if (sql.includes('FROM live_recovery_ingestions')) return this.ingestion
    if (sql.includes('FROM live_recovery_fill_observations')) return this.existingFill
    if (sql.includes('FROM live_recovery_accounting_task_intents')) return this.existingTask
    return null
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const bound = statements as unknown as FakeStatement[]
    this.batches.push(bound)
    const receipt = bound.find((statement) =>
      statement.sql.includes('INSERT INTO live_recovery_ingestions'))
    assert.ok(receipt)
    const params = receipt.params
    this.ingestion = {
      ingestion_id: String(params[0]),
      snapshot_id: String(params[3]),
      snapshot_hash: String(params[4]),
      request_hash: String(params[5]),
      ingestion_hash: String(params[6]),
      order_count: Number(params[10]),
      fill_count: Number(params[11]),
      accounting_task_count: Number(params[12]),
      accounting_applied: 0,
      reservation_settled: 0,
      provider_mutation_allowed: 0,
      execution_allowed: 0,
    }
    return []
  }

  asD1(): D1Database {
    return this as unknown as D1Database
  }
}

async function plan(overrides: { ingestionId?: string; snapshotHash?: string } = {}) {
  const snapshotHash = overrides.snapshotHash ?? 'a'.repeat(64)
  return buildBitgetRecoveryIngestionPlan({
    ingestionId: overrides.ingestionId ?? 'recovery-ingestion-1',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoveredAt: '2026-07-17T22:30:00.000Z',
    recovery: {
      snapshot: {
        orders: [],
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
          tradeTime: '2026-07-17T22:10:00.000Z',
          sequenceTimestamp: '2026-07-17T22:10:00.100Z',
        }],
        snapshotAt: '2026-07-17T22:29:59.000Z',
        serverTimestampMs: 1784327399000,
      },
      cursor: {
        connected: true,
        initialized: true,
        ordersSubscribed: true,
        fillsSubscribed: true,
        lastMessageAt: '2026-07-17T22:29:59.000Z',
        lastPongAt: null,
        lastServerTimestampMs: 1784327399000,
        lastRestSnapshotAt: '2026-07-17T22:29:59.000Z',
        recentFingerprints: [],
        recoveryRequired: false,
        recoveryReason: null,
      },
      snapshotHash,
      windowStartMs: 1784325600000,
      windowEndMs: 1784327400000,
      currentOrderCount: 0,
      historicalOrderCount: 0,
      fillCount: 1,
      readOnly: true,
      providerMutationAllowed: false,
      executionAllowed: false,
    },
  })
}

test('new recovery evidence is ingested in one D1 batch with one pending task', async () => {
  const database = new FakeDatabase()
  const result = await persistBitgetRecoveryIngestion(
    { DB: database.asD1() },
    await plan(),
  )

  assert.equal(result.status, 'INGESTED')
  assert.equal(result.fillCount, 1)
  assert.equal(result.accountingTaskCount, 1)
  assert.equal(result.newFillCount, 1)
  assert.equal(result.newAccountingTaskCount, 1)
  assert.equal(result.accountingApplied, false)
  assert.equal(result.reservationSettled, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(database.batches.length, 1)
  assert.ok(database.batches[0]?.some((statement) =>
    statement.sql.includes('INSERT INTO live_recovery_fill_observations')))
  assert.ok(database.batches[0]?.some((statement) =>
    statement.sql.includes('INSERT INTO live_recovery_accounting_task_intents')))
  assert.ok(database.batches[0]?.some((statement) =>
    statement.sql.includes('INSERT INTO live_recovery_ingestion_events')))
})

test('identical recovery ingestion replays without a second batch', async () => {
  const database = new FakeDatabase()
  const evidence = await plan()
  await persistBitgetRecoveryIngestion({ DB: database.asD1() }, evidence)
  const replay = await persistBitgetRecoveryIngestion({ DB: database.asD1() }, evidence)

  assert.equal(replay.status, 'REPLAYED')
  assert.equal(replay.newFillCount, 0)
  assert.equal(replay.newAccountingTaskCount, 0)
  assert.equal(database.batches.length, 1)
})

test('overlapping snapshot reuses an identical fill and its paired task intent', async () => {
  const database = new FakeDatabase()
  const evidence = await plan({
    ingestionId: 'recovery-ingestion-2',
    snapshotHash: 'b'.repeat(64),
  })
  const fill = evidence.fillObservations[0]
  const task = evidence.accountingTaskIntents[0]
  assert.ok(fill)
  assert.ok(task)
  database.existingFill = {
    observation_id: 'older-observation',
    fill_hash: fill.fillHash,
  }
  database.existingTask = {
    task_intent_id: task.taskIntentId,
    fill_hash: task.fillHash,
    status: 'PENDING_ACCOUNTING',
    accounting_applied: 0,
    reservation_settled: 0,
    provider_mutation_allowed: 0,
    execution_allowed: 0,
  }

  const result = await persistBitgetRecoveryIngestion(
    { DB: database.asD1() },
    evidence,
  )

  assert.equal(result.status, 'INGESTED')
  assert.equal(result.newFillCount, 0)
  assert.equal(result.newAccountingTaskCount, 0)
  assert.equal(database.batches.length, 1)
  assert.equal(database.batches[0]?.some((statement) =>
    statement.sql.includes('INSERT INTO live_recovery_fill_observations')), false)
  assert.equal(database.batches[0]?.some((statement) =>
    statement.sql.includes('INSERT INTO live_recovery_accounting_task_intents')), false)
})

test('unpaired existing fill or changed hash is quarantined', async () => {
  const evidence = await plan()
  const fill = evidence.fillObservations[0]
  assert.ok(fill)

  const unpaired = new FakeDatabase()
  unpaired.existingFill = {
    observation_id: 'older-observation',
    fill_hash: fill.fillHash,
  }
  await assert.rejects(
    persistBitgetRecoveryIngestion({ DB: unpaired.asD1() }, evidence),
    (error: unknown) => error instanceof RecoveryIngestionConflictError
      && /not paired/.test(error.message),
  )

  const changed = new FakeDatabase()
  changed.existingFill = {
    observation_id: 'older-observation',
    fill_hash: 'f'.repeat(64),
  }
  changed.existingTask = {
    task_intent_id: 'older-task',
    fill_hash: 'f'.repeat(64),
    status: 'PENDING_ACCOUNTING',
    accounting_applied: 0,
    reservation_settled: 0,
    provider_mutation_allowed: 0,
    execution_allowed: 0,
  }
  await assert.rejects(
    persistBitgetRecoveryIngestion({ DB: changed.asD1() }, evidence),
    (error: unknown) => error instanceof RecoveryIngestionConflictError
      && /fill hash conflicts/.test(error.message),
  )
})
