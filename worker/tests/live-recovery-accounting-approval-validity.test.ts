import assert from 'node:assert/strict'
import test from 'node:test'

import type { BitgetRecoveryAccountingPlan } from '../src/live/bitget-recovery-accounting-plan.ts'
import {
  persistTimeBoundRecoveryAccountingApproval,
  RecoveryAccountingApprovalValidityConflictError,
} from '../src/live/recovery-accounting-approval-validity.ts'
import type { RecoveryAccountingApprovalInput } from '../src/live/recovery-accounting-approval.ts'
import { calculateBitgetRecoveryAccountingPlanHash } from '../src/live/recovery-accounting-plan-integrity.ts'
import type { ScopedRole, StepUpSession } from '../src/live/authorization.ts'
import { asDecimalString } from '../src/live/decimal.ts'

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
  run(): Promise<D1Result>
}

class FakeD1 {
  plan: Record<string, unknown> | null = null
  approval: Record<string, unknown> | null = null
  validity: Record<string, unknown> | null = null
  batchCount = 0
  validityInsertCount = 0

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
          run: async () => database.run(sql, params),
        }
      },
      first: async <T>() => database.first<T>(sql),
      run: async () => database.run(sql, []),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan as T | null
    if (sql.includes('FROM live_recovery_accounting_approval_events')) {
      return this.approval as T | null
    }
    if (sql.includes('FROM live_recovery_accounting_approval_validity')) {
      return this.validity as T | null
    }
    if (sql.includes('FROM live_authorization_events')) return null
    return null
  }

  async run(sql: string, params: unknown[]): Promise<D1Result> {
    if (sql.includes('INSERT OR IGNORE INTO live_recovery_accounting_approval_validity')) {
      this.validityInsertCount += 1
      this.validity = {
        approval_event_id: String(params[0]),
        plan_id: String(params[1]),
        plan_hash: String(params[2]),
        valid_from: String(params[3]),
        expires_at: String(params[4]),
        validity_seconds: Number(params[5]),
        validity_hash: String(params[6]),
        operator_approved: 1,
        automatically_dispatched: 0,
        automatically_retried: 0,
        provider_mutation_allowed: 0,
        reservation_applied: 0,
        execution_allowed: 0,
      }
    }
    return {} as D1Result
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    const [planStatement, approvalStatement] = statements as unknown as FakeStatement[]
    const planParams = planStatement.params
    this.plan = {
      plan_id: String(planParams[0]),
      plan_hash: String(planParams[4]),
      recovery_snapshot_hash: String(planParams[3]),
      exchange_account_id: String(planParams[1]),
      product_id: String(planParams[2]),
      command_count: Number(planParams[5]),
      commands_json: String(planParams[6]),
      prepared_by_actor_id: String(planParams[7]),
      accounting_evidence_ready: 1,
      automatically_dispatched: 0,
      provider_mutation_allowed: 0,
      reservation_applied: 0,
      execution_allowed: 0,
    }
    const approvalParams = approvalStatement.params
    this.approval = {
      approval_event_id: String(approvalParams[0]),
      authorization_event_id: String(approvalParams[1]),
      plan_id: String(approvalParams[2]),
      plan_hash: String(approvalParams[3]),
      decision: String(approvalParams[6]),
      reasons_json: String(approvalParams[7]),
      approval_hash: String(approvalParams[11]),
      automatically_dispatched: 0,
      provider_mutation_allowed: 0,
      reservation_applied: 0,
      execution_allowed: 0,
    }
    return []
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

function role(value: ScopedRole['role']): ScopedRole {
  return {
    role: value,
    scopeType: 'ACCOUNT',
    scopeKey: 'bitget-account-ref',
    expiresAt: null,
    revokedAt: null,
  }
}

function stepUp(actorId: string, expiresAt: string): StepUpSession {
  return {
    stepUpSessionId: `step-up-${actorId}`,
    actorId,
    assuranceLevel: 'AAL2',
    audience: 'operations',
    issuedAt: '2026-07-17T21:55:00.000Z',
    expiresAt,
    revokedAt: null,
  }
}

async function plan(): Promise<BitgetRecoveryAccountingPlan> {
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
  return { ...hashable, planHash: await calculateBitgetRecoveryAccountingPlanHash(hashable) }
}

async function input(
  overrides: Partial<RecoveryAccountingApprovalInput> = {},
): Promise<RecoveryAccountingApprovalInput> {
  return {
    approvalEventId: 'approval-validity-1',
    authorizationEventId: 'authorization-validity-1',
    planId: 'plan-validity-1',
    plan: await plan(),
    planPreparedByActorId: 'planner-1',
    actorId: 'risk-operator-1',
    roles: [role('RISK_OPERATOR')],
    stepUpSession: stepUp('risk-operator-1', '2026-07-17T22:05:00.000Z'),
    correlationId: 'correlation-validity-1',
    auditEventHash: 'b'.repeat(64),
    evaluatedAt: '2026-07-17T22:00:00.000Z',
    ...overrides,
  }
}

test('approval validity is capped by the step-up expiry', async () => {
  const database = new FakeD1()
  const result = await persistTimeBoundRecoveryAccountingApproval(
    database.env(),
    await input(),
  )

  assert.equal(result.approved, true)
  assert.equal(result.validityStatus, 'PROJECTED')
  assert.equal(result.validFrom, '2026-07-17T22:00:00.000Z')
  assert.equal(result.expiresAt, '2026-07-17T22:05:00.000Z')
  assert.equal(result.validitySeconds, 300)
  assert.match(result.validityHash ?? '', /^[a-f0-9]{64}$/)
  assert.equal(database.validityInsertCount, 1)
})

test('approval validity is capped at fifteen minutes', async () => {
  const database = new FakeD1()
  const result = await persistTimeBoundRecoveryAccountingApproval(
    database.env(),
    await input({
      stepUpSession: stepUp('risk-operator-1', '2026-07-17T23:00:00.000Z'),
    }),
  )

  assert.equal(result.expiresAt, '2026-07-17T22:15:00.000Z')
  assert.equal(result.validitySeconds, 900)
})

test('denied approval receives no dispatch validity', async () => {
  const database = new FakeD1()
  const result = await persistTimeBoundRecoveryAccountingApproval(
    database.env(),
    await input({ roles: [role('VIEWER')], stepUpSession: null }),
  )

  assert.equal(result.approved, false)
  assert.equal(result.validityStatus, 'NOT_APPLICABLE')
  assert.equal(result.validityHash, null)
  assert.equal(database.validityInsertCount, 0)
})

test('identical validity evidence replays without another insert', async () => {
  const database = new FakeD1()
  const approvalInput = await input()
  await persistTimeBoundRecoveryAccountingApproval(database.env(), approvalInput)
  const replay = await persistTimeBoundRecoveryAccountingApproval(
    database.env(),
    approvalInput,
  )

  assert.equal(replay.validityStatus, 'REPLAYED')
  assert.equal(database.validityInsertCount, 1)
  assert.equal(database.batchCount, 1)
})

test('stored validity capability corruption is rejected', async () => {
  const database = new FakeD1()
  const approvalInput = await input()
  await persistTimeBoundRecoveryAccountingApproval(database.env(), approvalInput)
  assert.ok(database.validity)
  database.validity.execution_allowed = 1

  await assert.rejects(
    persistTimeBoundRecoveryAccountingApproval(database.env(), approvalInput),
    /capability locks/,
  )
})

test('approved validity cannot outlive an already expired step-up session', async () => {
  const database = new FakeD1()
  const result = await persistTimeBoundRecoveryAccountingApproval(
    database.env(),
    await input({
      stepUpSession: stepUp('risk-operator-1', '2026-07-17T21:59:59.000Z'),
    }),
  )

  assert.equal(result.approved, false)
  assert.equal(result.validityStatus, 'NOT_APPLICABLE')
})

test('conflicting validity evidence under one approval ID is rejected', async () => {
  const database = new FakeD1()
  const approvalInput = await input()
  await persistTimeBoundRecoveryAccountingApproval(database.env(), approvalInput)
  assert.ok(database.validity)
  database.validity.expires_at = '2026-07-17T22:06:00.000Z'

  await assert.rejects(
    persistTimeBoundRecoveryAccountingApproval(database.env(), approvalInput),
    RecoveryAccountingApprovalValidityConflictError,
  )
})
