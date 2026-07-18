import { canonicalHash } from './canonical-json.ts'
import {
  executeFreshApprovedRecoveryAccountingPackage,
  loadFreshApprovedRecoveryAccountingPackage,
  type FreshApprovedRecoveryAccountingPackage,
} from './recovery-accounting-dispatch-freshness.ts'
import {
  RecoveryAccountingDispatchConflictError,
  type RecoveryAccountingDispatchExecutor,
  type RecoveryAccountingDispatchResult,
} from './recovery-accounting-dispatch.ts'
import {
  persistRecoveryAccountingDispatchResult,
  type PersistRecoveryAccountingDispatchResult,
  type RecoveryAccountingDispatchStoreEnv,
} from './recovery-accounting-dispatch-store.ts'

const GENESIS_DISPATCH = 'GENESIS'

export interface FreshRecoveryAccountingDispatchInput {
  dispatchId: string
  planId: string
  approvalEventId: string
}

export interface RecoveryAccountingDispatchClock {
  now(): Date
}

const SYSTEM_CLOCK: RecoveryAccountingDispatchClock = Object.freeze({
  now: () => new Date(),
})

export interface RecoveryAccountingDispatchAttempt {
  dispatchId: string
  planId: string
  approvalEventId: string
  approvalValidityHash: string
  predecessorAttemptId: string
  planHash: string
  approvedByActorId: string
  planPreparedByActorId: string
  exchangeName: 'BITGET'
  exchangeAccountId: string
  productId: string
  commandCount: number
  attemptHash: string
  claimedAt: string
  operatorApproved: true
  automaticallyDispatched: false
  automaticallyRetried: false
  requiresAccountCoordinatorSerialization: true
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export interface FreshRecoveryAccountingDispatchOutcome {
  attempt: RecoveryAccountingDispatchAttempt
  dispatch: RecoveryAccountingDispatchResult
  persistence: PersistRecoveryAccountingDispatchResult
}

type DispatchRow = {
  dispatch_id: string
  approval_event_id: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
}

type LatestAttemptRow = {
  dispatch_id: string
  approval_event_id: string
}

type AttemptRow = {
  dispatch_id: string
  plan_id: string
  approval_event_id: string
  approval_validity_hash: string
  predecessor_attempt_id: string
  plan_hash: string
  approved_by_actor_id: string
  plan_prepared_by_actor_id: string
  exchange_name: string
  exchange_account_id: string
  product_id: string
  command_count: number
  attempt_hash: string
  operator_approved: number
  automatically_dispatched: number
  automatically_retried: number
  requires_coordinator_serialization: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  claimed_at: string
}

export class RecoveryAccountingDispatchAttemptConflictError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_DISPATCH_ATTEMPT_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingDispatchAttemptConflictError'
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function assertAttemptCapabilities(row: AttemptRow): void {
  if (
    row.operator_approved !== 1
    || row.automatically_dispatched !== 0
    || row.automatically_retried !== 0
    || row.requires_coordinator_serialization !== 1
    || row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'stored recovery accounting dispatch attempt violates capability locks',
    )
  }
}

async function latestDispatch(
  env: RecoveryAccountingDispatchStoreEnv,
  planId: string,
): Promise<DispatchRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_id, approval_event_id, status
      FROM live_recovery_accounting_dispatches
     WHERE plan_id = ?
     ORDER BY occurred_at DESC, dispatch_id DESC
     LIMIT 1
  `).bind(planId).first<DispatchRow>()
}

async function latestAttempt(
  env: RecoveryAccountingDispatchStoreEnv,
  planId: string,
): Promise<LatestAttemptRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_id, approval_event_id
      FROM live_recovery_accounting_dispatch_attempts
     WHERE plan_id = ?
     ORDER BY claimed_at DESC, dispatch_id DESC
     LIMIT 1
  `).bind(planId).first<LatestAttemptRow>()
}

async function existingAttempt(
  env: RecoveryAccountingDispatchStoreEnv,
  dispatchId: string,
  approvalEventId: string,
  planId: string,
  predecessorAttemptId: string,
): Promise<AttemptRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_id, plan_id, approval_event_id, approval_validity_hash,
           predecessor_attempt_id, plan_hash, approved_by_actor_id,
           plan_prepared_by_actor_id, exchange_name, exchange_account_id,
           product_id, command_count, attempt_hash, operator_approved,
           automatically_dispatched, automatically_retried,
           requires_coordinator_serialization, provider_mutation_allowed,
           reservation_applied, execution_allowed, claimed_at
      FROM live_recovery_accounting_dispatch_attempts
     WHERE dispatch_id = ? OR approval_event_id = ?
        OR (plan_id = ? AND predecessor_attempt_id = ?)
     LIMIT 1
  `).bind(
    dispatchId,
    approvalEventId,
    planId,
    predecessorAttemptId,
  ).first<AttemptRow>()
}

async function attemptEvidence(
  input: FreshRecoveryAccountingDispatchInput,
  approvedPackage: FreshApprovedRecoveryAccountingPackage,
  predecessorAttemptId: string,
  claimedAt: string,
): Promise<RecoveryAccountingDispatchAttempt> {
  const dispatchId = required(input.dispatchId, 'dispatchId')
  const evidence = {
    dispatchId,
    planId: approvedPackage.planId,
    approvalEventId: approvedPackage.approvalEventId,
    approvalValidityHash: approvedPackage.approvalValidityHash,
    predecessorAttemptId,
    planHash: approvedPackage.plan.planHash,
    approvedByActorId: approvedPackage.approvedByActorId,
    planPreparedByActorId: approvedPackage.planPreparedByActorId,
    exchangeName: approvedPackage.plan.exchangeName,
    exchangeAccountId: approvedPackage.plan.exchangeAccountId,
    productId: approvedPackage.plan.productId,
    commandCount: approvedPackage.plan.commandCount,
    claimedAt,
    operatorApproved: true as const,
    automaticallyDispatched: false as const,
    automaticallyRetried: false as const,
    requiresAccountCoordinatorSerialization: true as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  return Object.freeze({
    ...evidence,
    attemptHash: await canonicalHash(evidence),
  })
}

function assertStoredAttempt(
  row: AttemptRow,
  attempt: RecoveryAccountingDispatchAttempt,
): void {
  assertAttemptCapabilities(row)
  if (
    row.dispatch_id !== attempt.dispatchId
    || row.plan_id !== attempt.planId
    || row.approval_event_id !== attempt.approvalEventId
    || row.approval_validity_hash !== attempt.approvalValidityHash
    || row.predecessor_attempt_id !== attempt.predecessorAttemptId
    || row.plan_hash !== attempt.planHash
    || row.approved_by_actor_id !== attempt.approvedByActorId
    || row.plan_prepared_by_actor_id !== attempt.planPreparedByActorId
    || row.exchange_name !== attempt.exchangeName
    || row.exchange_account_id !== attempt.exchangeAccountId
    || row.product_id !== attempt.productId
    || row.command_count !== attempt.commandCount
    || row.attempt_hash !== attempt.attemptHash
    || row.claimed_at !== attempt.claimedAt
  ) {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'stored recovery accounting dispatch attempt conflicts with reviewed evidence',
    )
  }
}

export async function claimFreshRecoveryAccountingDispatchAttempt(
  env: RecoveryAccountingDispatchStoreEnv,
  input: FreshRecoveryAccountingDispatchInput,
  approvedPackage: FreshApprovedRecoveryAccountingPackage,
  claimedAt: string,
): Promise<RecoveryAccountingDispatchAttempt> {
  if (
    approvedPackage.planId !== required(input.planId, 'planId')
    || approvedPackage.approvalEventId !== required(input.approvalEventId, 'approvalEventId')
  ) {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'fresh approval package does not match the requested dispatch scope',
    )
  }
  const previous = await latestDispatch(env, approvedPackage.planId)
  const priorAttempt = await latestAttempt(env, approvedPackage.planId)
  if (previous?.status === 'COMPLETED') {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'completed recovery accounting plan cannot be dispatched again',
    )
  }
  const priorApprovalEventId = priorAttempt?.approval_event_id
    ?? previous?.approval_event_id
  if (priorApprovalEventId === approvedPackage.approvalEventId) {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'partial or failed dispatch requires a new independently reviewed approval',
    )
  }
  const predecessorAttemptId = priorAttempt?.dispatch_id
    ?? previous?.dispatch_id
    ?? GENESIS_DISPATCH
  const attempt = await attemptEvidence(
    input,
    approvedPackage,
    predecessorAttemptId,
    iso(claimedAt, 'claimedAt'),
  )
  if (await existingAttempt(
    env,
    attempt.dispatchId,
    attempt.approvalEventId,
    attempt.planId,
    attempt.predecessorAttemptId,
  )) {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'recovery accounting dispatch attempt is not unique',
    )
  }

  try {
    await env.DB.prepare(`
      INSERT INTO live_recovery_accounting_dispatch_attempts (
        dispatch_id, plan_id, approval_event_id, approval_validity_hash,
        predecessor_attempt_id, plan_hash, approved_by_actor_id,
        plan_prepared_by_actor_id, exchange_name, exchange_account_id,
        product_id, command_count, attempt_hash, operator_approved,
        automatically_dispatched, automatically_retried,
        requires_coordinator_serialization, provider_mutation_allowed,
        reservation_applied, execution_allowed, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BITGET', ?, ?, ?, ?, 1, 0, 0, 1, 0, 0, 0, ?)
    `).bind(
      attempt.dispatchId,
      attempt.planId,
      attempt.approvalEventId,
      attempt.approvalValidityHash,
      attempt.predecessorAttemptId,
      attempt.planHash,
      attempt.approvedByActorId,
      attempt.planPreparedByActorId,
      attempt.exchangeAccountId,
      attempt.productId,
      attempt.commandCount,
      attempt.attemptHash,
      attempt.claimedAt,
    ).run()
  } catch {
    throw new RecoveryAccountingDispatchAttemptConflictError(
      'recovery accounting dispatch attempt claim was rejected',
    )
  }
  const stored = await existingAttempt(
    env,
    attempt.dispatchId,
    attempt.approvalEventId,
    attempt.planId,
    attempt.predecessorAttemptId,
  )
  if (!stored) throw new Error('dispatch attempt is missing after immutable claim')
  assertStoredAttempt(stored, attempt)
  return attempt
}

export async function orchestrateFreshRecoveryAccountingDispatch(
  env: RecoveryAccountingDispatchStoreEnv,
  input: FreshRecoveryAccountingDispatchInput,
  executor: RecoveryAccountingDispatchExecutor,
  clock: RecoveryAccountingDispatchClock = SYSTEM_CLOCK,
): Promise<FreshRecoveryAccountingDispatchOutcome> {
  return executor.serializer.run(async () => {
    const evaluatedAt = iso(clock.now().toISOString(), 'clock.now')
    const approvedPackage = await loadFreshApprovedRecoveryAccountingPackage(
      env,
      input.planId,
      input.approvalEventId,
      evaluatedAt,
    )
    const attempt = await claimFreshRecoveryAccountingDispatchAttempt(
      env,
      input,
      approvedPackage,
      evaluatedAt,
    )
    const directExecutor: RecoveryAccountingDispatchExecutor = {
      serializer: { run: async (operation) => operation() },
      executeAccountingCommand: executor.executeAccountingCommand,
    }
    const dispatch = await executeFreshApprovedRecoveryAccountingPackage(
      attempt.dispatchId,
      approvedPackage,
      directExecutor,
    )
    if (dispatch.status === 'COMPLETED' && dispatch.completedCommandCount !== attempt.commandCount) {
      throw new RecoveryAccountingDispatchConflictError(
        'completed dispatch does not contain every reviewed command',
      )
    }
    const occurredAt = iso(clock.now().toISOString(), 'clock.now')
    if (Date.parse(occurredAt) < Date.parse(attempt.claimedAt)) {
      throw new RecoveryAccountingDispatchConflictError(
        'dispatch persistence time cannot precede its immutable attempt claim',
      )
    }
    const persistence = await persistRecoveryAccountingDispatchResult(
      env,
      approvedPackage,
      dispatch,
      occurredAt,
    )
    return Object.freeze({ attempt, dispatch, persistence })
  })
}
