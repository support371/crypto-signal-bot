import { canonicalHash } from './canonical-json.ts'
import {
  persistRecoveryAccountingApproval,
  type PersistRecoveryAccountingApprovalResult,
  type RecoveryAccountingApprovalStoreEnv,
} from './recovery-accounting-approval-store.ts'
import {
  evaluateVerifiedRecoveryAccountingApproval,
} from './recovery-accounting-approval-service.ts'
import type { RecoveryAccountingApprovalInput } from './recovery-accounting-approval.ts'

export interface PersistTimeBoundRecoveryAccountingApprovalResult
  extends PersistRecoveryAccountingApprovalResult {
  validityStatus: 'PROJECTED' | 'REPLAYED' | 'NOT_APPLICABLE'
  validFrom: string | null
  expiresAt: string | null
  validitySeconds: number | null
  validityHash: string | null
}

export class RecoveryAccountingApprovalValidityConflictError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_APPROVAL_VALIDITY_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingApprovalValidityConflictError'
  }
}

type ValidityRow = {
  approval_event_id: string
  plan_id: string
  plan_hash: string
  valid_from: string
  expires_at: string
  validity_seconds: number
  validity_hash: string
  operator_approved: number
  automatically_dispatched: number
  automatically_retried: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

const MAX_VALIDITY_MS = 15 * 60 * 1000

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return parsed
}

function normalizedIso(value: string, field: string): string {
  return new Date(timestamp(value, field)).toISOString()
}

function assertValidityCapabilities(row: ValidityRow): void {
  if (
    row.operator_approved !== 1
    || row.automatically_dispatched !== 0
    || row.automatically_retried !== 0
    || row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingApprovalValidityConflictError(
      'stored recovery accounting approval validity violates capability locks',
    )
  }
}

function validityEvidence(
  input: RecoveryAccountingApprovalInput,
): {
  validFrom: string
  expiresAt: string
  validitySeconds: number
} {
  if (!input.stepUpSession) {
    throw new RecoveryAccountingApprovalValidityConflictError(
      'approved recovery accounting plan requires a step-up session',
    )
  }
  const validFromMs = timestamp(input.evaluatedAt, 'evaluatedAt')
  const stepUpExpiryMs = timestamp(input.stepUpSession.expiresAt, 'stepUpSession.expiresAt')
  const expiresAtMs = Math.min(validFromMs + MAX_VALIDITY_MS, stepUpExpiryMs)
  if (expiresAtMs <= validFromMs) {
    throw new RecoveryAccountingApprovalValidityConflictError(
      'approved recovery accounting validity has already expired',
    )
  }
  const validitySeconds = Math.floor((expiresAtMs - validFromMs) / 1000)
  if (validitySeconds < 1 || validitySeconds > 900) {
    throw new RecoveryAccountingApprovalValidityConflictError(
      'approved recovery accounting validity must be 1-900 seconds',
    )
  }
  return {
    validFrom: new Date(validFromMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    validitySeconds,
  }
}

async function calculateValidityHash(
  input: RecoveryAccountingApprovalInput,
  validFrom: string,
  expiresAt: string,
  validitySeconds: number,
): Promise<string> {
  return canonicalHash({
    approvalEventId: input.approvalEventId,
    planId: input.planId,
    planHash: input.plan.planHash,
    validFrom,
    expiresAt,
    validitySeconds,
    operatorApproved: true,
    automaticallyDispatched: false,
    automaticallyRetried: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

async function loadValidity(
  env: RecoveryAccountingApprovalStoreEnv,
  input: RecoveryAccountingApprovalInput,
  validityHash: string,
): Promise<ValidityRow | null> {
  return env.DB.prepare(`
    SELECT approval_event_id, plan_id, plan_hash, valid_from, expires_at,
           validity_seconds, validity_hash, operator_approved,
           automatically_dispatched, automatically_retried,
           provider_mutation_allowed, reservation_applied, execution_allowed
      FROM live_recovery_accounting_approval_validity
     WHERE approval_event_id = ? OR validity_hash = ?
     LIMIT 1
  `).bind(input.approvalEventId, validityHash).first<ValidityRow>()
}

function assertValidityCompatible(
  row: ValidityRow,
  input: RecoveryAccountingApprovalInput,
  validFrom: string,
  expiresAt: string,
  validitySeconds: number,
  validityHash: string,
): void {
  assertValidityCapabilities(row)
  if (
    row.approval_event_id !== input.approvalEventId
    || row.plan_id !== input.planId
    || row.plan_hash !== input.plan.planHash
    || row.valid_from !== validFrom
    || row.expires_at !== expiresAt
    || row.validity_seconds !== validitySeconds
    || row.validity_hash !== validityHash
  ) {
    throw new RecoveryAccountingApprovalValidityConflictError(
      'stored recovery accounting approval validity conflicts with evidence',
    )
  }
}

export async function persistTimeBoundRecoveryAccountingApproval(
  env: RecoveryAccountingApprovalStoreEnv,
  input: RecoveryAccountingApprovalInput,
): Promise<PersistTimeBoundRecoveryAccountingApprovalResult> {
  const decision = await evaluateVerifiedRecoveryAccountingApproval(input)
  const approval = await persistRecoveryAccountingApproval(env, input)
  if (!decision.approved) {
    return Object.freeze({
      ...approval,
      validityStatus: 'NOT_APPLICABLE',
      validFrom: null,
      expiresAt: null,
      validitySeconds: null,
      validityHash: null,
      automaticallyDispatched: false,
      providerMutationAllowed: false,
      reservationApplied: false,
      executionAllowed: false,
    })
  }

  const { validFrom, expiresAt, validitySeconds } = validityEvidence(input)
  const normalizedValidFrom = normalizedIso(validFrom, 'validFrom')
  const normalizedExpiresAt = normalizedIso(expiresAt, 'expiresAt')
  const validityHash = await calculateValidityHash(
    input,
    normalizedValidFrom,
    normalizedExpiresAt,
    validitySeconds,
  )
  const existing = await loadValidity(env, input, validityHash)
  if (existing) {
    assertValidityCompatible(
      existing,
      input,
      normalizedValidFrom,
      normalizedExpiresAt,
      validitySeconds,
      validityHash,
    )
    return Object.freeze({
      ...approval,
      validityStatus: 'REPLAYED',
      validFrom: normalizedValidFrom,
      expiresAt: normalizedExpiresAt,
      validitySeconds,
      validityHash,
    })
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO live_recovery_accounting_approval_validity (
      approval_event_id, plan_id, plan_hash, valid_from, expires_at,
      validity_seconds, validity_hash, operator_approved,
      automatically_dispatched, automatically_retried,
      provider_mutation_allowed, reservation_applied, execution_allowed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0)
  `).bind(
    input.approvalEventId,
    input.planId,
    input.plan.planHash,
    normalizedValidFrom,
    normalizedExpiresAt,
    validitySeconds,
    validityHash,
  ).run()

  const projected = await loadValidity(env, input, validityHash)
  if (!projected) {
    throw new Error('recovery accounting approval validity is missing after insert')
  }
  assertValidityCompatible(
    projected,
    input,
    normalizedValidFrom,
    normalizedExpiresAt,
    validitySeconds,
    validityHash,
  )
  return Object.freeze({
    ...approval,
    validityStatus: 'PROJECTED',
    validFrom: normalizedValidFrom,
    expiresAt: normalizedExpiresAt,
    validitySeconds,
    validityHash,
  })
}
