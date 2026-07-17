import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalJson } from '../src/live/canonical-json.ts'
import type { BitgetRecoveryAccountingPlan } from '../src/live/bitget-recovery-accounting-plan.ts'
import {
  calculateBitgetRecoveryAccountingPlanHash,
} from '../src/live/recovery-accounting-plan-integrity.ts'
import type { RecoveryAccountingApprovalInput } from '../src/live/recovery-accounting-approval.ts'
import {
  persistRecoveryAccountingApproval,
  RecoveryAccountingApprovalConflictError,
  type RecoveryAccountingApprovalStoreEnv,
} from '../src/live/recovery-accounting-approval-store.ts'
import type { ScopedRole, StepUpSession } from '../src/live/authorization.ts'

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

type PlanRow = {
  plan_id: string
  plan_hash: string
  recovery_snapshot_hash: string
  exchange_account_id: string
  product_id: string
  command_count: number
  commands_json: string
  prepared_by_actor_id: string
  accounting_evidence_ready: number
  automatically_dispatched: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

type AuthorizationRow = {
  authorization_event_id: string
  actor_id: string
  action: string
  resource_type: string
  resource_id: string
  required_roles_json: string
  actor_roles_json: string
  step_up_required: number
  step_up_session_id: string | null
  decision: 'ALLOW' | 'DENY'
  reason: string | null
  correlation_id: string
  audit_event_hash: string
  occurred_at: string
}

type ApprovalRow = {
  approval_event_id: string
  authorization_event_id: string
  plan_id: string
  plan_hash: string
  actor_id: string
  plan_prepared_by_actor_id: string
  decision: 'APPROVED' | 'DENIED'
  reasons_json: string
  authorization_allowed: number
  matched_roles_json: string
  step_up_session_id: string | null
  approval_hash: string
  automatically_dispatched: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  occurred_at: string
}

class FakeDatabase {
  plan: PlanRow | null = null
  authorization: AuthorizationRow | null = null
  approval: ApprovalRow | null = null
  readonly batches: FakeStatement[][] = []

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string): unknown {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan
    if (sql.includes('FROM live_recovery_accounting_approval_events')) return this.approval
    if (sql.includes('FROM live_authorization_events')) return this.authorization
    return null
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const bound = statements as unknown as FakeStatement[]
    this.batches.push(bound)
    for (const statement of bound) {
      const params = statement.params
      if (statement.sql.includes('INSERT INTO live_recovery_accounting_plans')) {
        this.plan = {
          plan_id: String(params[0]),
          exchange_account_id: String(params[1]),
          product_id: String(params[2]),
          recovery_snapshot_hash: String(params[3]),
          plan_hash: String(params[4]),
          command_count: Number(params[5]),
          commands_json: String(params[6]),
          prepared_by_actor_id: String(params[7]),
          accounting_evidence_ready: 1,
          automatically_dispatched: 0,
          provider_mutation_allowed: 0,
          reservation_applied: 0,
          execution_allowed: 0,
        }
      } else if (statement.sql.includes('INSERT INTO live_authorization_events')) {
        this.authorization = {
          authorization_event_id: String(params[0]),
          actor_id: String(params[1]),
          action: String(params[2]),
          resource_type: String(params[3]),
          resource_id: String(params[4]),
          required_roles_json: String(params[5]),
          actor_roles_json: String(params[6]),
          step_up_required: Number(params[7]),
          step_up_session_id: params[8] === null ? null : String(params[8]),
          decision: String(params[9]) as 'ALLOW' | 'DENY',
          reason: params[10] === null ? null : String(params[10]),
          correlation_id: String(params[11]),
          audit_event_hash: String(params[12]),
          occurred_at: String(params[13]),
        }
      } else if (statement.sql.includes('INSERT INTO live_recovery_accounting_approval_events')) {
        this.approval = {
          approval_event_id: String(params[0]),
          authorization_event_id: String(params[1]),
          plan_id: String(params[2]),
          plan_hash: String(params[3]),
          actor_id: String(params[4]),
          plan_prepared_by_actor_id: String(params[5]),
          decision: String(params[6]) as 'APPROVED' | 'DENIED',
          reasons_json: String(params[7]),
          authorization_allowed: Number(params[8]),
          matched_roles_json: String(params[9]),
          step_up_session_id: params[10] === null ? null : String(params[10]),
          approval_hash: String(params[11]),
          automatically_dispatched: 0,
          provider_mutation_allowed: 0,
          reservation_applied: 0,
          execution_allowed: 0,
          occurred_at: String(params[12]),
        }
      }
    }
    return []
  }

  env(): RecoveryAccountingApprovalStoreEnv {
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

function stepUp(actorId: string): StepUpSession {
  return {
    stepUpSessionId: `step-up-${actorId}`,
    actorId,
    assuranceLevel: 'AAL2',
    audience: 'operations',
    issuedAt: '2026-07-17T21:55:00.000Z',
    expiresAt: '2026-07-17T22:05:00.000Z',
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
    commands: Object.freeze([]),
    accountingEvidenceReady: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  return Object.freeze({
    ...hashable,
    planHash: await calculateBitgetRecoveryAccountingPlanHash(hashable),
  })
}

async function input(
  overrides: Partial<RecoveryAccountingApprovalInput> = {},
): Promise<RecoveryAccountingApprovalInput> {
  return {
    approvalEventId: 'approval-event-1',
    authorizationEventId: 'authorization-event-1',
    planId: 'recovery-plan-1',
    plan: await plan(),
    planPreparedByActorId: 'planner-1',
    actorId: 'risk-operator-1',
    roles: [role('RISK_OPERATOR')],
    stepUpSession: stepUp('risk-operator-1'),
    correlationId: 'correlation-approval-1',
    auditEventHash: 'c'.repeat(64),
    evaluatedAt: '2026-07-17T22:00:00.000Z',
    ...overrides,
  }
}

test('approved evidence persists plan, authorization, and approval in one batch', async () => {
  const database = new FakeDatabase()
  const request = await input()
  const result = await persistRecoveryAccountingApproval(database.env(), request)

  assert.equal(result.status, 'PROJECTED')
  assert.equal(result.approved, true)
  assert.equal(result.planIntegrityVerified, true)
  assert.equal(result.automaticallyDispatched, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(database.batches.length, 1)
  assert.equal(database.batches[0]?.length, 3)
  assert.equal(database.authorization?.action, 'RUN_RECONCILIATION')
  assert.equal(database.authorization?.resource_type, 'RECOVERY_ACCOUNTING_PLAN')
  assert.equal(database.approval?.decision, 'APPROVED')
  assert.equal(database.plan?.commands_json, canonicalJson(request.plan.commands))
})

test('identical evidence replays without another batch', async () => {
  const database = new FakeDatabase()
  const request = await input()
  await persistRecoveryAccountingApproval(database.env(), request)
  const replay = await persistRecoveryAccountingApproval(database.env(), request)

  assert.equal(replay.status, 'REPLAYED')
  assert.equal(replay.approved, true)
  assert.equal(database.batches.length, 1)
})

test('denied approval is persisted without dispatch capability', async () => {
  const database = new FakeDatabase()
  const request = await input({ roles: [role('VIEWER')], stepUpSession: null })
  const result = await persistRecoveryAccountingApproval(database.env(), request)

  assert.equal(result.approved, false)
  assert.equal(database.authorization?.decision, 'DENY')
  assert.equal(database.approval?.decision, 'DENIED')
  assert.equal(result.automaticallyDispatched, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
})

test('approval replay requires immutable plan and authorization evidence', async () => {
  const database = new FakeDatabase()
  const request = await input()
  await persistRecoveryAccountingApproval(database.env(), request)
  database.plan = null

  await assert.rejects(
    persistRecoveryAccountingApproval(database.env(), request),
    (error: unknown) => error instanceof RecoveryAccountingApprovalConflictError
      && /without its immutable plan/.test(error.message),
  )
})

test('capability-lock corruption is quarantined on replay', async () => {
  const database = new FakeDatabase()
  const request = await input()
  await persistRecoveryAccountingApproval(database.env(), request)
  assert.ok(database.plan)
  database.plan.automatically_dispatched = 1

  await assert.rejects(
    persistRecoveryAccountingApproval(database.env(), request),
    (error: unknown) => error instanceof RecoveryAccountingApprovalConflictError
      && /permanent capability locks/.test(error.message),
  )
})
