import assert from 'node:assert/strict'
import test from 'node:test'

import type { BitgetRecoveryAccountingPlan } from '../src/live/bitget-recovery-accounting-plan.ts'
import {
  persistRecoveryAccountingApproval,
  RecoveryAccountingApprovalConflictError,
  type RecoveryAccountingApprovalStoreEnv,
} from '../src/live/recovery-accounting-approval-store.ts'
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

type ApprovalRow = {
  approval_event_id: string
  authorization_event_id: string
  plan_id: string
  plan_hash: string
  decision: 'APPROVED' | 'DENIED'
  reasons_json: string
  approval_hash: string
  automatically_dispatched: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

class FakeD1 {
  plan: PlanRow | null = null
  approval: ApprovalRow | null = null
  authorizationRunCount = 0
  batchCount = 0

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const base: FakeStatement = {
      sql,
      params: [],
      bind(...params: unknown[]) {
        const bound: FakeStatement = {
          sql,
          params,
          bind: base.bind,
          first: async <T>() => database.first<T>(sql),
          run: async () => database.run(sql),
        }
        return bound
      },
      first: async <T>() => database.first<T>(sql),
      run: async () => database.run(sql),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan as T | null
    if (sql.includes('FROM live_recovery_accounting_approval_events')) {
      return this.approval as T | null
    }
    if (sql.includes('FROM live_authorization_events')) return null
    return null
  }

  async run(sql: string): Promise<D1Result> {
    if (sql.includes('INSERT INTO live_authorization_events')) {
      this.authorizationRunCount += 1
    }
    return {} as D1Result
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    const [planStatement, approvalStatement] = statements as unknown as FakeStatement[]
    const planParams = planStatement.params
    this.plan = {
      plan_id: String(planParams[0]),
      exchange_account_id: String(planParams[1]),
      product_id: String(planParams[2]),
      recovery_snapshot_hash: String(planParams[3]),
      plan_hash: String(planParams[4]),
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
      decision: approvalParams[6] as ApprovalRow['decision'],
      reasons_json: String(approvalParams[7]),
      approval_hash: String(approvalParams[11]),
      automatically_dispatched: 0,
      provider_mutation_allowed: 0,
      reservation_applied: 0,
      execution_allowed: 0,
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
    commandCount: 1,
    commands: [{
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
    }],
    accountingEvidenceReady: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  return {
    ...hashable,
    planHash: await calculateBitgetRecoveryAccountingPlanHash(hashable),
  }
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

test('approved evidence persists authorization, immutable plan, and approval event', async () => {
  const database = new FakeD1()
  const result = await persistRecoveryAccountingApproval(database.env(), await input())

  assert.equal(result.status, 'PROJECTED')
  assert.equal(result.approved, true)
  assert.equal(result.planIntegrityVerified, true)
  assert.equal(result.automaticallyDispatched, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(database.authorizationRunCount, 1)
  assert.equal(database.batchCount, 1)
  assert.equal(database.approval?.decision, 'APPROVED')
})

test('denied approval is still persisted without dispatch capability', async () => {
  const database = new FakeD1()
  const deniedInput = await input({
    roles: [role('VIEWER')],
    stepUpSession: null,
  })
  const result = await persistRecoveryAccountingApproval(database.env(), deniedInput)

  assert.equal(result.approved, false)
  assert.equal(database.approval?.decision, 'DENIED')
  assert.equal(result.automaticallyDispatched, false)
  assert.equal(result.executionAllowed, false)
})

test('identical approval replays without a second authorization insert or batch', async () => {
  const database = new FakeD1()
  const approvalInput = await input()
  const projected = await persistRecoveryAccountingApproval(database.env(), approvalInput)
  const replay = await persistRecoveryAccountingApproval(database.env(), approvalInput)

  assert.equal(replay.status, 'REPLAYED')
  assert.equal(replay.approvalHash, projected.approvalHash)
  assert.equal(database.authorizationRunCount, 1)
  assert.equal(database.batchCount, 1)
})

test('changed approval evidence under the same event ID is rejected', async () => {
  const database = new FakeD1()
  await persistRecoveryAccountingApproval(database.env(), await input())

  await assert.rejects(
    persistRecoveryAccountingApproval(database.env(), await input({
      actorId: 'risk-admin-2',
      roles: [role('RISK_ADMIN')],
      stepUpSession: stepUp('risk-admin-2'),
    })),
    RecoveryAccountingApprovalConflictError,
  )
})

test('stored plan and approval capability corruption is rejected', async () => {
  const database = new FakeD1()
  const approvalInput = await input()
  await persistRecoveryAccountingApproval(database.env(), approvalInput)
  assert.ok(database.plan)
  database.plan.execution_allowed = 1

  await assert.rejects(
    persistRecoveryAccountingApproval(database.env(), approvalInput),
    /permanent capability locks/,
  )

  database.plan.execution_allowed = 0
  assert.ok(database.approval)
  database.approval.automatically_dispatched = 1
  await assert.rejects(
    persistRecoveryAccountingApproval(database.env(), approvalInput),
    /permanent capability locks/,
  )
})

test('tampered plan commands fail integrity before any D1 query', async () => {
  const database = new FakeD1()
  const approvalInput = await input()
  approvalInput.plan = {
    ...approvalInput.plan,
    commands: [{
      ...approvalInput.plan.commands[0],
      internalOrderId: 'tampered-order',
    }],
  }

  await assert.rejects(
    persistRecoveryAccountingApproval(database.env(), approvalInput),
    /plan hash does not match its commands/,
  )
  assert.equal(database.authorizationRunCount, 0)
  assert.equal(database.batchCount, 0)
})
