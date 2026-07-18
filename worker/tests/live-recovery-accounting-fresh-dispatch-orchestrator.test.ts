import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash } from '../src/live/canonical-json.ts'
import {
  claimFreshRecoveryAccountingDispatchAttempt,
  orchestrateFreshRecoveryAccountingDispatch,
  RecoveryAccountingDispatchAttemptConflictError,
} from '../src/live/recovery-accounting-fresh-dispatch-orchestrator.ts'
import {
  loadFreshApprovedRecoveryAccountingPackage,
} from '../src/live/recovery-accounting-dispatch-freshness.ts'
import {
  calculateBitgetRecoveryAccountingPlanHash,
} from '../src/live/recovery-accounting-plan-integrity.ts'

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

class FakeD1 {
  plan: Record<string, unknown> | null = null
  approval: Record<string, unknown> | null = null
  validity: Record<string, unknown> | null = null
  latestDispatch: Record<string, unknown> | null = null
  dispatches: Record<string, unknown>[] = []
  attempts: Record<string, unknown>[] = []
  batchCount = 0

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const statement = (params: unknown[] = []): FakeStatement => ({
      sql,
      params,
      bind: (...next: unknown[]) => statement(next),
      first: async <T>() => database.first<T>(sql, params),
      all: async <T>() => database.all<T>(sql, params),
      run: async () => database.run(sql, params),
    })
    return statement() as unknown as D1PreparedStatement
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan as T | null
    if (sql.includes('FROM live_recovery_accounting_approval_events')) {
      return this.approval as T | null
    }
    if (sql.includes('FROM live_recovery_accounting_approval_validity')) {
      return this.validity as T | null
    }
    if (
      sql.includes('FROM live_recovery_accounting_dispatches')
      && sql.includes('ORDER BY occurred_at')
    ) {
      return this.latestDispatch as T | null
    }
    if (sql.includes('FROM live_recovery_accounting_dispatches')) {
      const [dispatchId, dispatchHash] = params.map(String)
      return (this.dispatches.find((dispatch) => (
        dispatch.dispatch_id === dispatchId || dispatch.dispatch_hash === dispatchHash
      )) ?? null) as T | null
    }
    if (
      sql.includes('FROM live_recovery_accounting_dispatch_attempts')
      && sql.includes('ORDER BY claimed_at')
    ) {
      return (this.attempts.at(-1) ?? null) as T | null
    }
    if (sql.includes('FROM live_recovery_accounting_dispatch_attempts')) {
      const [dispatchId, approvalEventId, planId, predecessorAttemptId] = params.map(String)
      return (this.attempts.find((attempt) => (
        attempt.dispatch_id === dispatchId
        || attempt.approval_event_id === approvalEventId
        || (
          attempt.plan_id === planId
          && attempt.predecessor_attempt_id === predecessorAttemptId
        )
      )) ?? null) as T | null
    }
    return null
  }

  async all<T>(sql: string, params: unknown[]): Promise<D1Result<T>> {
    if (sql.includes('FROM live_recovery_accounting_dispatch_receipts')) {
      return { results: [] } as D1Result<T>
    }
    return { results: [] } as D1Result<T>
  }

  async run(sql: string, params: unknown[]): Promise<D1Result> {
    if (sql.includes('INSERT INTO live_recovery_accounting_dispatch_attempts')) {
      this.attempts.push({
        dispatch_id: String(params[0]),
        plan_id: String(params[1]),
        approval_event_id: String(params[2]),
        approval_validity_hash: String(params[3]),
        predecessor_attempt_id: String(params[4]),
        plan_hash: String(params[5]),
        approved_by_actor_id: String(params[6]),
        plan_prepared_by_actor_id: String(params[7]),
        exchange_name: 'BITGET',
        exchange_account_id: String(params[8]),
        product_id: String(params[9]),
        command_count: Number(params[10]),
        attempt_hash: String(params[11]),
        operator_approved: 1,
        automatically_dispatched: 0,
        automatically_retried: 0,
        requires_coordinator_serialization: 1,
        provider_mutation_allowed: 0,
        reservation_applied: 0,
        execution_allowed: 0,
        claimed_at: String(params[12]),
      })
    }
    if (sql.includes('INSERT INTO live_recovery_accounting_dispatches')) {
      this.dispatches.push({
        dispatch_id: String(params[0]),
        plan_id: String(params[1]),
        approval_event_id: String(params[2]),
        plan_hash: String(params[3]),
        status: String(params[4]),
        command_count: Number(params[5]),
        completed_command_count: Number(params[6]),
        failed_command_index: params[7] as number | null,
        failed_fill_id: params[8] as string | null,
        failure_code: params[9] as string | null,
        dispatch_hash: String(params[10]),
        operator_approved: 1,
        automatically_dispatched: 0,
        automatically_retried: 0,
        requires_coordinator_serialization: 1,
        provider_mutation_allowed: 0,
        reservation_applied: 0,
        execution_allowed: 0,
        occurred_at: String(params[11]),
      })
      this.latestDispatch = this.dispatches.at(-1) ?? null
    }
    return {} as D1Result
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    const results: D1Result[] = []
    for (const statement of statements as unknown as FakeStatement[]) {
      results.push(await this.run(statement.sql, statement.params))
    }
    return results
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

async function configureApproval(database: FakeD1, approvalEventId: string): Promise<void> {
  const validFrom = '2026-07-17T22:00:00.000Z'
  const expiresAt = '2026-07-17T22:05:00.000Z'
  const validitySeconds = 300
  const planHash = String(database.plan?.plan_hash)
  database.approval = {
    approval_event_id: approvalEventId,
    authorization_event_id: `authorization:${approvalEventId}`,
    plan_id: 'recovery-plan-1',
    plan_hash: planHash,
    actor_id: `risk:${approvalEventId}`,
    plan_prepared_by_actor_id: 'planner-1',
    decision: 'APPROVED',
    authorization_allowed: 1,
    approval_hash: 'c'.repeat(64),
    automatically_dispatched: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
    occurred_at: validFrom,
  }
  database.validity = {
    approval_event_id: approvalEventId,
    plan_id: 'recovery-plan-1',
    plan_hash: planHash,
    valid_from: validFrom,
    expires_at: expiresAt,
    validity_seconds: validitySeconds,
    validity_hash: await canonicalHash({
      approvalEventId,
      planId: 'recovery-plan-1',
      planHash,
      validFrom,
      expiresAt,
      validitySeconds,
      operatorApproved: true,
      automaticallyDispatched: false,
      automaticallyRetried: false,
      providerMutationAllowed: false,
      reservationApplied: false,
      executionAllowed: false,
    }),
    operator_approved: 1,
    automatically_dispatched: 0,
    automatically_retried: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
  }
}

async function configuredDatabase(): Promise<FakeD1> {
  const database = new FakeD1()
  const hashable = {
    exchangeName: 'BITGET' as const,
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoverySnapshotHash: 'a'.repeat(64),
    commandCount: 0,
    commands: [],
    accountingEvidenceReady: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  database.plan = {
    plan_id: 'recovery-plan-1',
    exchange_name: 'BITGET',
    plan_hash: await calculateBitgetRecoveryAccountingPlanHash(hashable),
    recovery_snapshot_hash: hashable.recoverySnapshotHash,
    exchange_account_id: hashable.exchangeAccountId,
    product_id: hashable.productId,
    command_count: 0,
    commands_json: '[]',
    prepared_by_actor_id: 'planner-1',
    accounting_evidence_ready: 1,
    automatically_dispatched: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
  }
  await configureApproval(database, 'approval-1')
  return database
}

async function freshPackage(database: FakeD1, approvalEventId: string) {
  return loadFreshApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    approvalEventId,
    '2026-07-17T22:01:00.000Z',
  )
}

test('first reviewed dispatch claims one immutable genesis attempt', async () => {
  const database = await configuredDatabase()
  const approved = await freshPackage(database, 'approval-1')
  const attempt = await claimFreshRecoveryAccountingDispatchAttempt(
    database.env(),
    {
      dispatchId: 'dispatch-1',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-1',
    },
    approved,
    '2026-07-17T22:01:00.000Z',
  )

  assert.equal(attempt.predecessorAttemptId, 'GENESIS')
  assert.equal(attempt.approvedByActorId, 'risk:approval-1')
  assert.equal(attempt.planPreparedByActorId, 'planner-1')
  assert.equal(attempt.automaticallyRetried, false)
  assert.equal(attempt.providerMutationAllowed, false)
  assert.equal(attempt.reservationApplied, false)
  assert.equal(attempt.executionAllowed, false)
  assert.equal(database.attempts.length, 1)
})

test('attempt identity and reviewed approval cannot be replayed', async () => {
  const database = await configuredDatabase()
  const approved = await freshPackage(database, 'approval-1')
  const input = {
    dispatchId: 'dispatch-1',
    planId: 'recovery-plan-1',
    approvalEventId: 'approval-1',
  }
  await claimFreshRecoveryAccountingDispatchAttempt(
    database.env(),
    input,
    approved,
    '2026-07-17T22:01:00.000Z',
  )
  await assert.rejects(
    claimFreshRecoveryAccountingDispatchAttempt(
      database.env(),
      input,
      approved,
      '2026-07-17T22:01:00.000Z',
    ),
    RecoveryAccountingDispatchAttemptConflictError,
  )
  assert.equal(database.attempts.length, 1)
})

test('orphaned immutable attempt resumes only through a new reviewed approval', async () => {
  const database = await configuredDatabase()
  const firstApproval = await freshPackage(database, 'approval-1')
  await claimFreshRecoveryAccountingDispatchAttempt(
    database.env(),
    {
      dispatchId: 'dispatch-orphaned',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-1',
    },
    firstApproval,
    '2026-07-17T22:01:00.000Z',
  )

  await configureApproval(database, 'approval-2')
  const secondApproval = await freshPackage(database, 'approval-2')
  const resumed = await claimFreshRecoveryAccountingDispatchAttempt(
    database.env(),
    {
      dispatchId: 'dispatch-reviewed-resume',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-2',
    },
    secondApproval,
    '2026-07-17T22:02:00.000Z',
  )

  assert.equal(resumed.predecessorAttemptId, 'dispatch-orphaned')
  assert.equal(resumed.approvalEventId, 'approval-2')
  assert.equal(database.attempts.length, 2)
})

test('completed plan and same-approval partial resume fail before a claim', async () => {
  const completed = await configuredDatabase()
  completed.latestDispatch = {
    dispatch_id: 'dispatch-complete',
    approval_event_id: 'approval-old',
    status: 'COMPLETED',
  }
  const approved = await freshPackage(completed, 'approval-1')
  await assert.rejects(
    claimFreshRecoveryAccountingDispatchAttempt(completed.env(), {
      dispatchId: 'dispatch-2',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-1',
    }, approved, '2026-07-17T22:01:00.000Z'),
    /cannot be dispatched again/,
  )

  const partial = await configuredDatabase()
  partial.latestDispatch = {
    dispatch_id: 'dispatch-partial',
    approval_event_id: 'approval-1',
    status: 'PARTIAL',
  }
  await assert.rejects(
    claimFreshRecoveryAccountingDispatchAttempt(partial.env(), {
      dispatchId: 'dispatch-2',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-1',
    }, await freshPackage(partial, 'approval-1'), '2026-07-17T22:01:00.000Z'),
    /new independently reviewed approval/,
  )
})

test('partial result can resume only with fresh independent approval evidence', async () => {
  const database = await configuredDatabase()
  database.latestDispatch = {
    dispatch_id: 'dispatch-partial',
    approval_event_id: 'approval-1',
    status: 'PARTIAL',
  }
  await configureApproval(database, 'approval-2')
  const approved = await freshPackage(database, 'approval-2')
  const attempt = await claimFreshRecoveryAccountingDispatchAttempt(
    database.env(),
    {
      dispatchId: 'dispatch-2',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-2',
    },
    approved,
    '2026-07-17T22:01:00.000Z',
  )

  assert.equal(attempt.predecessorAttemptId, 'dispatch-partial')
  assert.equal(attempt.approvalEventId, 'approval-2')
  assert.equal(attempt.automaticallyRetried, false)
})

test('fresh orchestration claims, serializes, and persists a completed reviewed plan', async () => {
  const database = await configuredDatabase()
  let serializerCalls = 0
  let accountingCalls = 0
  const outcome = await orchestrateFreshRecoveryAccountingDispatch(
    database.env(),
    {
      dispatchId: 'dispatch-orchestrated',
      planId: 'recovery-plan-1',
      approvalEventId: 'approval-1',
    },
    {
      serializer: {
        run: async <T>(operation: () => Promise<T>): Promise<T> => {
          serializerCalls += 1
          return operation()
        },
      },
      executeAccountingCommand: async () => {
        accountingCalls += 1
        throw new Error('zero-command plan must not execute accounting')
      },
    },
    { now: () => new Date('2026-07-17T22:01:00.000Z') },
  )

  assert.equal(serializerCalls, 1)
  assert.equal(accountingCalls, 0)
  assert.equal(outcome.dispatch.status, 'COMPLETED')
  assert.equal(outcome.persistence.projectionStatus, 'PROJECTED')
  assert.equal(outcome.attempt.providerMutationAllowed, false)
  assert.equal(outcome.dispatch.executionAllowed, false)
  assert.equal(database.attempts.length, 1)
  assert.equal(database.dispatches.length, 1)
  assert.equal(database.batchCount, 1)
})

test('orchestration uses its trusted clock and rejects expired approval before claim', async () => {
  const database = await configuredDatabase()
  await assert.rejects(
    orchestrateFreshRecoveryAccountingDispatch(
      database.env(),
      {
        dispatchId: 'dispatch-expired',
        planId: 'recovery-plan-1',
        approvalEventId: 'approval-1',
      },
      {
        serializer: {
          run: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
        },
        executeAccountingCommand: async () => {
          throw new Error('expired approval must not execute accounting')
        },
      },
      { now: () => new Date('2026-07-17T22:06:00.000Z') },
    ),
    /expired/,
  )
  assert.equal(database.attempts.length, 0)
  assert.equal(database.dispatches.length, 0)
})
