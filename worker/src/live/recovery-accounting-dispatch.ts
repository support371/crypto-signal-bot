import { canonicalHash } from './canonical-json.ts'
import type { VerifiedFillAccountingResult } from './fill-accounting-service.ts'
import type { FillAccountingSerialQueue } from './fill-accounting-serialization.ts'
import type { BitgetRecoveryAccountingPlan } from './bitget-recovery-accounting-plan.ts'
import { assertBitgetRecoveryAccountingPlanIntegrity } from './recovery-accounting-plan-integrity.ts'
import type { RecoveryAccountingApprovalStoreEnv } from './recovery-accounting-approval-store.ts'

export interface ApprovedRecoveryAccountingPackage {
  planId: string
  approvalEventId: string
  authorizationEventId: string
  approvedByActorId: string
  plan: BitgetRecoveryAccountingPlan
  approvalHash: string
  approvalOccurredAt: string
  operatorApproved: true
  automaticallyDispatched: false
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export interface RecoveryAccountingCommandReceipt {
  commandIndex: number
  fillId: string
  status: 'PROJECTED' | 'REPLAYED'
  accountingReceiptId: string
  journalId: string
  accountingHash: string
  positionQuantity: string
  cumulativeRealizedPnlQuote: string
}

export interface RecoveryAccountingDispatchResult {
  dispatchId: string
  planId: string
  approvalEventId: string
  planHash: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  commandCount: number
  completedCommandCount: number
  receipts: readonly RecoveryAccountingCommandReceipt[]
  failedCommandIndex: number | null
  failedFillId: string | null
  failureCode: string | null
  dispatchHash: string
  operatorApproved: true
  automaticallyDispatched: false
  automaticallyRetried: false
  requiresAccountCoordinatorSerialization: true
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export interface RecoveryAccountingDispatchExecutor {
  serializer: Pick<FillAccountingSerialQueue, 'run'>
  executeAccountingCommand(
    command: BitgetRecoveryAccountingPlan['commands'][number],
  ): Promise<VerifiedFillAccountingResult>
}

export class RecoveryAccountingDispatchNotApprovedError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_DISPATCH_NOT_APPROVED'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingDispatchNotApprovedError'
  }
}

export class RecoveryAccountingDispatchConflictError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_DISPATCH_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingDispatchConflictError'
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
  actor_id: string
  decision: 'APPROVED' | 'DENIED'
  authorization_allowed: number
  approval_hash: string
  automatically_dispatched: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  occurred_at: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function parseCommands(value: string): BitgetRecoveryAccountingPlan['commands'] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new RecoveryAccountingDispatchConflictError(
      'stored recovery accounting commands are not valid JSON',
    )
  }
  if (!Array.isArray(parsed)) {
    throw new RecoveryAccountingDispatchConflictError(
      'stored recovery accounting commands must be an array',
    )
  }
  return Object.freeze(parsed) as BitgetRecoveryAccountingPlan['commands']
}

function assertZeroCapabilities(
  row: {
    automatically_dispatched: number
    provider_mutation_allowed: number
    reservation_applied: number
    execution_allowed: number
  },
  field: string,
): void {
  if (
    row.automatically_dispatched !== 0
    || row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingDispatchConflictError(
      `${field} violates the permanent capability locks`,
    )
  }
}

export async function loadApprovedRecoveryAccountingPackage(
  env: RecoveryAccountingApprovalStoreEnv,
  planId: string,
  approvalEventId: string,
): Promise<ApprovedRecoveryAccountingPackage> {
  const normalizedPlanId = required(planId, 'planId')
  const normalizedApprovalEventId = required(approvalEventId, 'approvalEventId')
  const planRow = await env.DB.prepare(`
    SELECT plan_id, plan_hash, recovery_snapshot_hash, exchange_account_id,
           product_id, command_count, commands_json, accounting_evidence_ready,
           automatically_dispatched, provider_mutation_allowed,
           reservation_applied, execution_allowed
      FROM live_recovery_accounting_plans
     WHERE plan_id = ?
     LIMIT 1
  `).bind(normalizedPlanId).first<PlanRow>()
  const approvalRow = await env.DB.prepare(`
    SELECT approval_event_id, authorization_event_id, plan_id, plan_hash,
           actor_id, decision, authorization_allowed, approval_hash,
           automatically_dispatched, provider_mutation_allowed,
           reservation_applied, execution_allowed, occurred_at
      FROM live_recovery_accounting_approval_events
     WHERE approval_event_id = ?
     LIMIT 1
  `).bind(normalizedApprovalEventId).first<ApprovalRow>()

  if (!planRow || !approvalRow) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'immutable recovery accounting plan or approval evidence is missing',
    )
  }
  assertZeroCapabilities(planRow, 'stored recovery accounting plan')
  assertZeroCapabilities(approvalRow, 'stored recovery accounting approval')
  if (
    approvalRow.decision !== 'APPROVED'
    || approvalRow.authorization_allowed !== 1
  ) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting plan does not have an approved authorization event',
    )
  }
  if (
    planRow.plan_id !== normalizedPlanId
    || approvalRow.plan_id !== normalizedPlanId
    || approvalRow.approval_event_id !== normalizedApprovalEventId
    || approvalRow.plan_hash !== planRow.plan_hash
    || planRow.accounting_evidence_ready !== 1
  ) {
    throw new RecoveryAccountingDispatchConflictError(
      'recovery accounting plan and approval evidence do not match',
    )
  }

  const plan: BitgetRecoveryAccountingPlan = Object.freeze({
    exchangeName: 'BITGET',
    exchangeAccountId: required(planRow.exchange_account_id, 'exchangeAccountId'),
    productId: required(planRow.product_id, 'productId'),
    recoverySnapshotHash: sha256(
      planRow.recovery_snapshot_hash,
      'recoverySnapshotHash',
    ),
    commandCount: planRow.command_count,
    commands: parseCommands(planRow.commands_json),
    planHash: sha256(planRow.plan_hash, 'planHash'),
    accountingEvidenceReady: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
  await assertBitgetRecoveryAccountingPlanIntegrity(plan)

  return Object.freeze({
    planId: normalizedPlanId,
    approvalEventId: normalizedApprovalEventId,
    authorizationEventId: required(
      approvalRow.authorization_event_id,
      'authorizationEventId',
    ),
    approvedByActorId: required(approvalRow.actor_id, 'approvedByActorId'),
    plan,
    approvalHash: sha256(approvalRow.approval_hash, 'approvalHash'),
    approvalOccurredAt: iso(approvalRow.occurred_at, 'approvalOccurredAt'),
    operatorApproved: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.name)) {
    return error.name
  }
  return 'RECOVERY_ACCOUNTING_COMMAND_FAILED'
}

function validateCommandResult(
  command: BitgetRecoveryAccountingPlan['commands'][number],
  result: VerifiedFillAccountingResult,
): RecoveryAccountingCommandReceipt {
  if (
    result.exchangeName !== 'BITGET'
    || result.fillId !== command.fill.fillId
    || result.providerMutationAllowed !== false
    || result.reservationApplied !== false
    || result.executionAllowed !== false
  ) {
    throw new RecoveryAccountingDispatchConflictError(
      'accounting command result violates the approved plan or capability locks',
    )
  }
  return Object.freeze({
    commandIndex: 0,
    fillId: result.fillId,
    status: result.status,
    accountingReceiptId: result.accountingReceiptId,
    journalId: result.journalId,
    accountingHash: result.accountingHash,
    positionQuantity: result.positionQuantity,
    cumulativeRealizedPnlQuote: result.cumulativeRealizedPnlQuote,
  })
}

export async function executeApprovedRecoveryAccountingPackage(
  dispatchId: string,
  approvedPackage: ApprovedRecoveryAccountingPackage,
  executor: RecoveryAccountingDispatchExecutor,
): Promise<RecoveryAccountingDispatchResult> {
  const normalizedDispatchId = required(dispatchId, 'dispatchId')
  await assertBitgetRecoveryAccountingPlanIntegrity(approvedPackage.plan)
  if (
    approvedPackage.operatorApproved !== true
    || approvedPackage.automaticallyDispatched !== false
    || approvedPackage.providerMutationAllowed !== false
    || approvedPackage.reservationApplied !== false
    || approvedPackage.executionAllowed !== false
  ) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting package violates approval or capability requirements',
    )
  }

  return executor.serializer.run(async () => {
    const receipts: RecoveryAccountingCommandReceipt[] = []
    let failedCommandIndex: number | null = null
    let failedFillId: string | null = null
    let failureCode: string | null = null

    for (let index = 0; index < approvedPackage.plan.commands.length; index += 1) {
      const command = approvedPackage.plan.commands[index]
      try {
        const result = await executor.executeAccountingCommand(command)
        receipts.push(Object.freeze({
          ...validateCommandResult(command, result),
          commandIndex: index,
        }))
      } catch (error) {
        failedCommandIndex = index
        failedFillId = command.fill.fillId
        failureCode = safeFailureCode(error)
        break
      }
    }

    const status = failedCommandIndex === null
      ? 'COMPLETED'
      : receipts.length === 0
        ? 'FAILED'
        : 'PARTIAL'
    const dispatchHash = await canonicalHash({
      dispatchId: normalizedDispatchId,
      planId: approvedPackage.planId,
      approvalEventId: approvedPackage.approvalEventId,
      planHash: approvedPackage.plan.planHash,
      status,
      commandCount: approvedPackage.plan.commandCount,
      completedCommandCount: receipts.length,
      receipts,
      failedCommandIndex,
      failedFillId,
      failureCode,
      operatorApproved: true,
      automaticallyDispatched: false,
      automaticallyRetried: false,
      requiresAccountCoordinatorSerialization: true,
      providerMutationAllowed: false,
      reservationApplied: false,
      executionAllowed: false,
    })

    return Object.freeze({
      dispatchId: normalizedDispatchId,
      planId: approvedPackage.planId,
      approvalEventId: approvedPackage.approvalEventId,
      planHash: approvedPackage.plan.planHash,
      status,
      commandCount: approvedPackage.plan.commandCount,
      completedCommandCount: receipts.length,
      receipts: Object.freeze(receipts),
      failedCommandIndex,
      failedFillId,
      failureCode,
      dispatchHash,
      operatorApproved: true,
      automaticallyDispatched: false,
      automaticallyRetried: false,
      requiresAccountCoordinatorSerialization: true,
      providerMutationAllowed: false,
      reservationApplied: false,
      executionAllowed: false,
    })
  })
}
