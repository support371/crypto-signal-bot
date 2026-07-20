import { canonicalHash } from '../../canonical-json.ts'
/*
 * This import intentionally checks the runner module's private in-memory
 * verification brand at the persistence boundary. The runner imports this
 * store, but the assertion is invoked only after both ESM modules initialize.
 */
import {
  assertFreshBitgetDemoControlEvidenceVerified,
  type BitgetDemoReadOnlyRecoveryReceipt,
  type VerifiedFreshBitgetDemoControlEvidence,
} from './demo-certification-runner.ts'
import type { ReviewedBitgetDemoDispatchOutcome } from './demo-dispatch-orchestrator.ts'
import type { BitgetDemoDispatchEvidenceEnv } from './demo-dispatch-evidence-store.ts'
import {
  assertBitgetDemoCandidateIntegrity,
  assertBitgetDemoDispatchAuthorizationVerified,
  type VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'
import type { BitgetUnsignedMutationCandidate } from './execution-candidate.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

interface PermanentLocks {
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

export interface BitgetDemoControlVerificationProjectionReceipt extends PermanentLocks {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  dispatchAttemptId: string
  authorizationId: string
  candidateHash: string
  claimHash: string
  verificationHash: string
  verifiedAt: string
  providerMutationAllowed: false
  executionAllowed: false
}

export interface BitgetDemoReadOnlyRecoveryAttempt extends PermanentLocks {
  recoveryAttemptId: string
  dispatchAttemptId: string
  authorizationId: string
  exchangeAccountId: string
  candidateHash: string
  resultHash: string
  lookupPlanHash: string
  lookupCount: number
  requestedAt: string
  attemptHash: string
  oneShot: true
  readOnly: true
  providerMutationAllowed: false
  executionAllowed: false
  accountingAutomaticallyDispatched: false
}

export interface BitgetDemoRecoveryReceiptProjectionReceipt extends PermanentLocks {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  recoveryAttemptId: string
  dispatchAttemptId: string
  recoveryId: string
  receiptHash: string
  status: 'RECOVERED' | 'INCOMPLETE'
  readOnly: true
  providerMutationAllowed: false
  executionAllowed: false
  accountingAutomaticallyDispatched: false
}

interface ControlContextRow {
  dispatch_attempt_id: string
  authorization_id: string
  exchange_account_id: string
  candidate_hash: string
  operation: string
  product_symbol: string
  claim_hash: string
  guardian_evidence_hash: string
  risk_evidence_hash: string
  idempotency_evidence_hash: string
}

interface ControlVerificationRow extends ControlContextRow {
  verified_at: string
  verification_hash: string
  environment: string
  guardian_clear: number
  risk_approved: number
  idempotency_claimed: number
  provider_mutation_allowed: number
  execution_allowed: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatically_retried: number
}

interface RecoveryAttemptRow {
  recovery_attempt_id: string
  dispatch_attempt_id: string
  authorization_id: string
  exchange_account_id: string
  candidate_hash: string
  result_hash: string
  lookup_plan_hash: string
  lookup_count: number
  requested_at: string
  attempt_hash: string
  environment: string
  one_shot: number
  read_only: number
  provider_mutation_allowed: number
  execution_allowed: number
  accounting_automatically_dispatched: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatically_retried: number
}

interface RecoveryReceiptRow {
  recovery_attempt_id: string
  dispatch_attempt_id: string
  authorization_id: string
  exchange_account_id: string
  candidate_hash: string
  recovery_id: string
  result_hash: string
  lookup_plan_hash: string
  lookup_count: number
  status: 'RECOVERED' | 'INCOMPLETE'
  snapshot_hash: string | null
  observed_at: string
  receipt_hash: string
  environment: string
  read_only: number
  provider_mutation_allowed: number
  execution_allowed: number
  accounting_automatically_dispatched: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatically_retried: number
}

export class BitgetDemoCertificationEvidenceConflictError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetDemoCertificationEvidenceConflictError'
    this.code = code
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CERTIFICATION_EVIDENCE_INVALID',
      `${field} is invalid`,
    )
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CERTIFICATION_EVIDENCE_INVALID',
      `${field} must be a SHA-256 digest`,
    )
  }
  return normalized
}

function canonicalTimestamp(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  const milliseconds = Date.parse(normalized)
  if (!normalized || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CERTIFICATION_EVIDENCE_INVALID',
      `${field} must be a canonical ISO-8601 timestamp`,
    )
  }
  return normalized
}

function productSymbol(candidate: BitgetUnsignedMutationCandidate): string {
  return requiredIdentifier(candidate.unsignedBody.symbol ?? '', 'candidate product symbol')
}

function assertPermanentLocks(value: PermanentLocks, field: string): void {
  if (
    value.liveExecutionAllowed !== false
    || value.realFundsAllowed !== false
    || value.mainnetAllowed !== false
    || value.withdrawalsAllowed !== false
    || value.automaticRetryAllowed !== false
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CERTIFICATION_CAPABILITY_LOCK_INVALID',
      `${field} violates permanent capability locks`,
    )
  }
}

function assertStoredZeroCapabilities(
  row: Pick<
    ControlVerificationRow | RecoveryAttemptRow | RecoveryReceiptRow,
    | 'provider_mutation_allowed'
    | 'execution_allowed'
    | 'live_execution_allowed'
    | 'real_funds_allowed'
    | 'mainnet_allowed'
    | 'withdrawals_allowed'
    | 'automatically_retried'
  >,
  field: string,
): void {
  if (
    row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatically_retried !== 0
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CERTIFICATION_STORED_CAPABILITY_INVALID',
      `${field} contains an enabled capability`,
    )
  }
}

async function loadControlContext(
  env: BitgetDemoDispatchEvidenceEnv,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
): Promise<ControlContextRow> {
  const row = await env.DB.prepare(`
    SELECT authorization.dispatch_attempt_id, authorization.authorization_id,
           authorization.exchange_account_id, authorization.candidate_hash,
           authorization.operation, authorization.product_symbol,
           authorization.guardian_evidence_hash, authorization.risk_evidence_hash,
           authorization.idempotency_evidence_hash, claim.claim_hash
      FROM live_bitget_demo_dispatch_authorizations authorization
      JOIN live_bitget_demo_dispatch_claims claim
        ON claim.authorization_id = authorization.authorization_id
       AND claim.dispatch_attempt_id = authorization.dispatch_attempt_id
     WHERE authorization.authorization_id = ?
       AND authorization.dispatch_attempt_id = ?
     LIMIT 1
  `).bind(
    authorization.authorizationId,
    authorization.dispatchAttemptId,
  ).first<ControlContextRow>()
  if (!row) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CONTROL_VERIFICATION_REQUIRES_CLAIM',
      'fresh-control verification requires the exact immutable one-shot claim',
    )
  }
  return row
}

async function loadControlVerification(
  env: BitgetDemoDispatchEvidenceEnv,
  input: {
    dispatchAttemptId: string
    authorizationId: string
    candidateHash: string
    verificationHash: string
  },
): Promise<ControlVerificationRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_attempt_id, authorization_id, exchange_account_id,
           candidate_hash, operation, product_symbol, claim_hash,
           guardian_evidence_hash, risk_evidence_hash,
           idempotency_evidence_hash, verified_at, verification_hash,
           environment, guardian_clear, risk_approved, idempotency_claimed,
           provider_mutation_allowed, execution_allowed,
           live_execution_allowed, real_funds_allowed, mainnet_allowed,
           withdrawals_allowed, automatically_retried
      FROM live_bitget_demo_control_verifications
     WHERE dispatch_attempt_id = ? OR authorization_id = ?
        OR candidate_hash = ? OR verification_hash = ?
     LIMIT 1
  `).bind(
    input.dispatchAttemptId,
    input.authorizationId,
    input.candidateHash,
    input.verificationHash,
  ).first<ControlVerificationRow>()
}

function assertControlRowMatches(
  row: ControlVerificationRow,
  expected: {
    context: ControlContextRow
    verified: VerifiedFreshBitgetDemoControlEvidence
    verificationHash: string
  },
): void {
  assertStoredZeroCapabilities(row, 'stored fresh-control verification')
  if (
    row.dispatch_attempt_id !== expected.context.dispatch_attempt_id
    || row.authorization_id !== expected.context.authorization_id
    || row.exchange_account_id !== expected.context.exchange_account_id
    || row.candidate_hash !== expected.context.candidate_hash
    || row.operation !== expected.context.operation
    || row.product_symbol !== expected.context.product_symbol
    || row.claim_hash !== expected.context.claim_hash
    || row.guardian_evidence_hash !== expected.verified.guardianEvidenceHash
    || row.risk_evidence_hash !== expected.verified.riskEvidenceHash
    || row.idempotency_evidence_hash !== expected.verified.idempotencyEvidenceHash
    || row.verified_at !== expected.verified.verifiedAt
    || row.verification_hash !== expected.verificationHash
    || row.environment !== 'BITGET_DEMO'
    || row.guardian_clear !== 1
    || row.risk_approved !== 1
    || row.idempotency_claimed !== 1
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CONTROL_VERIFICATION_CONFLICT',
      'stored fresh-control verification conflicts with the reviewed one-shot attempt',
    )
  }
}

function controlReceipt(
  projectionStatus: BitgetDemoControlVerificationProjectionReceipt['projectionStatus'],
  context: ControlContextRow,
  verificationHash: string,
  verifiedAt: string,
): BitgetDemoControlVerificationProjectionReceipt {
  return Object.freeze({
    projectionStatus,
    dispatchAttemptId: context.dispatch_attempt_id,
    authorizationId: context.authorization_id,
    candidateHash: context.candidate_hash,
    claimHash: context.claim_hash,
    verificationHash,
    verifiedAt,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
}

export async function recordBitgetDemoControlVerification(
  env: BitgetDemoDispatchEvidenceEnv,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  verified: VerifiedFreshBitgetDemoControlEvidence,
): Promise<BitgetDemoControlVerificationProjectionReceipt> {
  assertBitgetDemoDispatchAuthorizationVerified(authorization)
  await assertBitgetDemoCandidateIntegrity(candidate)
  assertFreshBitgetDemoControlEvidenceVerified(verified)
  assertPermanentLocks(verified, 'fresh-control verification')
  const context = await loadControlContext(env, authorization)
  const verifiedAt = canonicalTimestamp(verified.verifiedAt, 'verifiedAt')
  if (
    context.exchange_account_id !== authorization.exchangeAccountId
    || context.candidate_hash !== candidate.candidateHash
    || context.operation !== candidate.operation
    || context.product_symbol !== productSymbol(candidate)
    || context.guardian_evidence_hash !== authorization.guardianEvidenceHash
    || context.risk_evidence_hash !== authorization.riskEvidenceHash
    || context.idempotency_evidence_hash !== authorization.idempotencyEvidenceHash
    || verified.exchangeAccountId !== context.exchange_account_id
    || verified.candidateHash !== context.candidate_hash
    || verified.operation !== context.operation
    || verified.productSymbol !== context.product_symbol
    || verified.guardianEvidenceHash !== context.guardian_evidence_hash
    || verified.riskEvidenceHash !== context.risk_evidence_hash
    || verified.idempotencyEvidenceHash !== context.idempotency_evidence_hash
    || verified.guardianClear !== true
    || verified.riskApproved !== true
    || verified.idempotencyClaimed !== true
    || Date.parse(verifiedAt) < Date.parse(authorization.validFrom)
    || Date.parse(verifiedAt) >= Date.parse(authorization.expiresAt)
    || Date.parse(verifiedAt) < Date.parse(candidate.builtAt)
    || Date.parse(verifiedAt) >= Date.parse(candidate.expiresAt)
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CONTROL_VERIFICATION_BINDING_INVALID',
      'fresh-control verification does not bind the reviewed candidate and immutable claim',
    )
  }
  const verificationHash = await canonicalHash({
    schemaVersion: 1,
    dispatchAttemptId: context.dispatch_attempt_id,
    authorizationId: context.authorization_id,
    exchangeAccountId: context.exchange_account_id,
    candidateHash: context.candidate_hash,
    operation: context.operation,
    productSymbol: context.product_symbol,
    claimHash: context.claim_hash,
    guardianEvidenceHash: verified.guardianEvidenceHash,
    riskEvidenceHash: verified.riskEvidenceHash,
    idempotencyEvidenceHash: verified.idempotencyEvidenceHash,
    verifiedAt,
    environment: 'BITGET_DEMO',
    guardianClear: true,
    riskApproved: true,
    idempotencyClaimed: true,
    providerMutationAllowed: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
  })
  const existing = await loadControlVerification(env, {
    dispatchAttemptId: context.dispatch_attempt_id,
    authorizationId: context.authorization_id,
    candidateHash: context.candidate_hash,
    verificationHash,
  })
  if (existing) {
    assertControlRowMatches(existing, { context, verified, verificationHash })
    return controlReceipt('REPLAYED', context, verificationHash, verifiedAt)
  }
  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_control_verifications (
        dispatch_attempt_id, authorization_id, exchange_account_id,
        candidate_hash, operation, product_symbol, claim_hash,
        guardian_evidence_hash, risk_evidence_hash,
        idempotency_evidence_hash, verified_at, verification_hash,
        environment, guardian_clear, risk_approved, idempotency_claimed,
        provider_mutation_allowed, execution_allowed, live_execution_allowed,
        real_funds_allowed, mainnet_allowed, withdrawals_allowed,
        automatically_retried
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BITGET_DEMO',
        1, 1, 1, 0, 0, 0, 0, 0, 0, 0)
    `).bind(
      context.dispatch_attempt_id,
      context.authorization_id,
      context.exchange_account_id,
      context.candidate_hash,
      context.operation,
      context.product_symbol,
      context.claim_hash,
      verified.guardianEvidenceHash,
      verified.riskEvidenceHash,
      verified.idempotencyEvidenceHash,
      verifiedAt,
      verificationHash,
    ).run()
  } catch {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'CONTROL_VERIFICATION_INSERT_REJECTED',
      'fresh-control verification insert was rejected',
    )
  }
  const stored = await loadControlVerification(env, {
    dispatchAttemptId: context.dispatch_attempt_id,
    authorizationId: context.authorization_id,
    candidateHash: context.candidate_hash,
    verificationHash,
  })
  if (!stored) throw new Error('fresh-control verification is missing after immutable insert')
  assertControlRowMatches(stored, { context, verified, verificationHash })
  return controlReceipt('PROJECTED', context, verificationHash, verifiedAt)
}

async function loadRecoveryAttempt(
  env: BitgetDemoDispatchEvidenceEnv,
  input: {
    recoveryAttemptId: string
    dispatchAttemptId: string
    authorizationId: string
    candidateHash: string
    resultHash: string
    attemptHash: string
  },
): Promise<RecoveryAttemptRow | null> {
  return env.DB.prepare(`
    SELECT recovery_attempt_id, dispatch_attempt_id, authorization_id,
           exchange_account_id, candidate_hash, result_hash,
           lookup_plan_hash, lookup_count, requested_at, attempt_hash,
           environment, one_shot, read_only, provider_mutation_allowed, execution_allowed,
           accounting_automatically_dispatched, live_execution_allowed,
           real_funds_allowed, mainnet_allowed, withdrawals_allowed,
           automatically_retried
      FROM live_bitget_demo_recovery_attempts
     WHERE recovery_attempt_id = ? OR dispatch_attempt_id = ?
        OR authorization_id = ? OR candidate_hash = ?
        OR result_hash = ? OR attempt_hash = ?
     LIMIT 1
  `).bind(
    input.recoveryAttemptId,
    input.dispatchAttemptId,
    input.authorizationId,
    input.candidateHash,
    input.resultHash,
    input.attemptHash,
  ).first<RecoveryAttemptRow>()
}

function recoveryAttemptFromRow(row: RecoveryAttemptRow): BitgetDemoReadOnlyRecoveryAttempt {
  assertStoredZeroCapabilities(row, 'stored read-only recovery attempt')
  if (
    row.one_shot !== 1
    || row.read_only !== 1
    || row.environment !== 'BITGET_DEMO'
    || row.accounting_automatically_dispatched !== 0
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_ATTEMPT_CAPABILITY_INVALID',
      'stored recovery attempt violates one-shot read-only capability locks',
    )
  }
  return Object.freeze({
    recoveryAttemptId: row.recovery_attempt_id,
    dispatchAttemptId: row.dispatch_attempt_id,
    authorizationId: row.authorization_id,
    exchangeAccountId: row.exchange_account_id,
    candidateHash: row.candidate_hash,
    resultHash: row.result_hash,
    lookupPlanHash: row.lookup_plan_hash,
    lookupCount: row.lookup_count,
    requestedAt: row.requested_at,
    attemptHash: row.attempt_hash,
    oneShot: true as const,
    readOnly: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    accountingAutomaticallyDispatched: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
}

export async function claimBitgetDemoReadOnlyRecoveryAttempt(
  env: BitgetDemoDispatchEvidenceEnv,
  outcome: ReviewedBitgetDemoDispatchOutcome,
  requestedAtInput: string,
): Promise<BitgetDemoReadOnlyRecoveryAttempt> {
  const requestedAt = canonicalTimestamp(requestedAtInput, 'recovery requestedAt')
  assertPermanentLocks(outcome.result, 'persisted ambiguous demo result')
  if (
    !outcome.result.requiresReadOnlyRecovery
    || outcome.result.recoveryLookups.length < 1
    || outcome.result.recoveryLookups.length > 2
    || outcome.persistence.resultHash !== await canonicalHash(outcome.result)
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_ATTEMPT_BINDING_INVALID',
      'one-shot recovery claim requires an exact persisted ambiguous demo result',
    )
  }
  const lookupPlanHash = await canonicalHash(outcome.result.recoveryLookups)
  const recoveryAttemptId = `bitget-demo-recovery-attempt-${outcome.persistence.resultHash.slice(0, 32)}`
  const base = Object.freeze({
    schemaVersion: 1 as const,
    recoveryAttemptId,
    dispatchAttemptId: outcome.result.dispatchAttemptId,
    authorizationId: outcome.result.authorizationId,
    exchangeAccountId: outcome.result.exchangeAccountId,
    candidateHash: outcome.result.candidateHash,
    resultHash: outcome.persistence.resultHash,
    lookupPlanHash,
    lookupCount: outcome.result.recoveryLookups.length,
    requestedAt,
    oneShot: true as const,
    readOnly: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    accountingAutomaticallyDispatched: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
  const attemptHash = await canonicalHash(base)
  const existing = await loadRecoveryAttempt(env, {
    recoveryAttemptId,
    dispatchAttemptId: base.dispatchAttemptId,
    authorizationId: base.authorizationId,
    candidateHash: base.candidateHash,
    resultHash: base.resultHash,
    attemptHash,
  })
  if (existing) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_ATTEMPT_ALREADY_CLAIMED',
      'read-only recovery attempt is already durably claimed and cannot be retried automatically',
    )
  }
  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_recovery_attempts (
        recovery_attempt_id, dispatch_attempt_id, authorization_id,
        exchange_account_id, candidate_hash, result_hash,
        lookup_plan_hash, lookup_count, requested_at, attempt_hash,
        one_shot, read_only, provider_mutation_allowed, execution_allowed,
        accounting_automatically_dispatched, live_execution_allowed,
        real_funds_allowed, mainnet_allowed, withdrawals_allowed,
        automatically_retried
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0)
    `).bind(
      recoveryAttemptId,
      base.dispatchAttemptId,
      base.authorizationId,
      base.exchangeAccountId,
      base.candidateHash,
      base.resultHash,
      base.lookupPlanHash,
      base.lookupCount,
      base.requestedAt,
      attemptHash,
    ).run()
  } catch {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_ATTEMPT_INSERT_REJECTED',
      'one-shot read-only recovery claim was rejected',
    )
  }
  const stored = await loadRecoveryAttempt(env, {
    recoveryAttemptId,
    dispatchAttemptId: base.dispatchAttemptId,
    authorizationId: base.authorizationId,
    candidateHash: base.candidateHash,
    resultHash: base.resultHash,
    attemptHash,
  })
  if (!stored) throw new Error('read-only recovery attempt is missing after immutable insert')
  const claim = recoveryAttemptFromRow(stored)
  if (
    claim.recoveryAttemptId !== recoveryAttemptId
    || claim.dispatchAttemptId !== base.dispatchAttemptId
    || claim.authorizationId !== base.authorizationId
    || claim.exchangeAccountId !== base.exchangeAccountId
    || claim.candidateHash !== base.candidateHash
    || claim.resultHash !== base.resultHash
    || claim.lookupPlanHash !== base.lookupPlanHash
    || claim.lookupCount !== base.lookupCount
    || claim.requestedAt !== base.requestedAt
    || claim.attemptHash !== attemptHash
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_ATTEMPT_CONFLICT',
      'stored read-only recovery attempt conflicts with persisted demo result',
    )
  }
  return claim
}

async function loadRecoveryReceipt(
  env: BitgetDemoDispatchEvidenceEnv,
  input: {
    recoveryAttemptId: string
    dispatchAttemptId: string
    authorizationId: string
    candidateHash: string
    recoveryId: string
    resultHash: string
    receiptHash: string
  },
): Promise<RecoveryReceiptRow | null> {
  return env.DB.prepare(`
    SELECT recovery_attempt_id, dispatch_attempt_id, authorization_id,
           exchange_account_id, candidate_hash, recovery_id, result_hash,
           lookup_plan_hash, lookup_count, status, snapshot_hash,
           observed_at, receipt_hash, environment, read_only, provider_mutation_allowed,
           execution_allowed, accounting_automatically_dispatched,
           live_execution_allowed, real_funds_allowed, mainnet_allowed,
           withdrawals_allowed, automatically_retried
      FROM live_bitget_demo_recovery_receipts
     WHERE recovery_attempt_id = ? OR dispatch_attempt_id = ?
        OR authorization_id = ? OR candidate_hash = ? OR recovery_id = ?
        OR result_hash = ? OR receipt_hash = ?
     LIMIT 1
  `).bind(
    input.recoveryAttemptId,
    input.dispatchAttemptId,
    input.authorizationId,
    input.candidateHash,
    input.recoveryId,
    input.resultHash,
    input.receiptHash,
  ).first<RecoveryReceiptRow>()
}

function assertRecoveryReceiptRowMatches(
  row: RecoveryReceiptRow,
  attempt: BitgetDemoReadOnlyRecoveryAttempt,
  receipt: BitgetDemoReadOnlyRecoveryReceipt,
): void {
  assertStoredZeroCapabilities(row, 'stored read-only recovery receipt')
  if (
    row.recovery_attempt_id !== attempt.recoveryAttemptId
    || row.dispatch_attempt_id !== attempt.dispatchAttemptId
    || row.authorization_id !== attempt.authorizationId
    || row.exchange_account_id !== attempt.exchangeAccountId
    || row.candidate_hash !== attempt.candidateHash
    || row.recovery_id !== receipt.recoveryId
    || row.result_hash !== attempt.resultHash
    || row.lookup_plan_hash !== attempt.lookupPlanHash
    || row.lookup_count !== attempt.lookupCount
    || row.status !== receipt.status
    || row.snapshot_hash !== receipt.snapshotHash
    || row.observed_at !== receipt.observedAt
    || row.receipt_hash !== receipt.receiptHash
    || row.environment !== 'BITGET_DEMO'
    || row.read_only !== 1
    || row.accounting_automatically_dispatched !== 0
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_RECEIPT_CONFLICT',
      'stored read-only recovery receipt conflicts with its one-shot attempt',
    )
  }
}

function recoveryReceiptProjection(
  projectionStatus: BitgetDemoRecoveryReceiptProjectionReceipt['projectionStatus'],
  attempt: BitgetDemoReadOnlyRecoveryAttempt,
  receipt: BitgetDemoReadOnlyRecoveryReceipt,
): BitgetDemoRecoveryReceiptProjectionReceipt {
  return Object.freeze({
    projectionStatus,
    recoveryAttemptId: attempt.recoveryAttemptId,
    dispatchAttemptId: attempt.dispatchAttemptId,
    recoveryId: receipt.recoveryId,
    receiptHash: receipt.receiptHash,
    status: receipt.status,
    readOnly: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    accountingAutomaticallyDispatched: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
}

export async function persistBitgetDemoReadOnlyRecoveryReceipt(
  env: BitgetDemoDispatchEvidenceEnv,
  attempt: BitgetDemoReadOnlyRecoveryAttempt,
  receipt: BitgetDemoReadOnlyRecoveryReceipt,
): Promise<BitgetDemoRecoveryReceiptProjectionReceipt> {
  assertPermanentLocks(attempt, 'read-only recovery attempt')
  assertPermanentLocks(receipt, 'read-only recovery receipt')
  requiredIdentifier(attempt.recoveryAttemptId, 'recoveryAttemptId')
  requiredHash(attempt.attemptHash, 'attemptHash')
  requiredIdentifier(receipt.recoveryId, 'recoveryId')
  requiredHash(receipt.receiptHash, 'receiptHash')
  const observedAt = canonicalTimestamp(receipt.observedAt, 'receipt observedAt')
  const { receiptHash, ...receiptBase } = receipt
  if (
    attempt.oneShot !== true
    || attempt.readOnly !== true
    || attempt.providerMutationAllowed !== false
    || attempt.executionAllowed !== false
    || attempt.accountingAutomaticallyDispatched !== false
    || receipt.dispatchAttemptId !== attempt.dispatchAttemptId
    || receipt.authorizationId !== attempt.authorizationId
    || receipt.exchangeAccountId !== attempt.exchangeAccountId
    || receipt.candidateHash !== attempt.candidateHash
    || receipt.resultHash !== attempt.resultHash
    || receipt.lookupPlanHash !== attempt.lookupPlanHash
    || receipt.lookupCount !== attempt.lookupCount
    || receipt.readOnly !== true
    || receipt.providerMutationAllowed !== false
    || receipt.executionAllowed !== false
    || receipt.accountingAutomaticallyDispatched !== false
    || Date.parse(observedAt) < Date.parse(attempt.requestedAt)
    || await canonicalHash(receiptBase) !== receiptHash
  ) {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_RECEIPT_BINDING_INVALID',
      'read-only recovery receipt does not bind the immutable one-shot attempt',
    )
  }
  const existing = await loadRecoveryReceipt(env, {
    recoveryAttemptId: attempt.recoveryAttemptId,
    dispatchAttemptId: attempt.dispatchAttemptId,
    authorizationId: attempt.authorizationId,
    candidateHash: attempt.candidateHash,
    recoveryId: receipt.recoveryId,
    resultHash: attempt.resultHash,
    receiptHash,
  })
  if (existing) {
    assertRecoveryReceiptRowMatches(existing, attempt, receipt)
    return recoveryReceiptProjection('REPLAYED', attempt, receipt)
  }
  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_recovery_receipts (
        recovery_attempt_id, dispatch_attempt_id, authorization_id,
        exchange_account_id, candidate_hash, recovery_id, result_hash,
        lookup_plan_hash, lookup_count, status, snapshot_hash, observed_at,
        receipt_hash, read_only, provider_mutation_allowed, execution_allowed,
        accounting_automatically_dispatched, live_execution_allowed,
        real_funds_allowed, mainnet_allowed, withdrawals_allowed,
        automatically_retried
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0, 0, 0, 0)
    `).bind(
      attempt.recoveryAttemptId,
      attempt.dispatchAttemptId,
      attempt.authorizationId,
      attempt.exchangeAccountId,
      attempt.candidateHash,
      receipt.recoveryId,
      attempt.resultHash,
      attempt.lookupPlanHash,
      attempt.lookupCount,
      receipt.status,
      receipt.snapshotHash,
      observedAt,
      receiptHash,
    ).run()
  } catch {
    throw new BitgetDemoCertificationEvidenceConflictError(
      'RECOVERY_RECEIPT_INSERT_REJECTED',
      'read-only recovery receipt insert was rejected',
    )
  }
  const stored = await loadRecoveryReceipt(env, {
    recoveryAttemptId: attempt.recoveryAttemptId,
    dispatchAttemptId: attempt.dispatchAttemptId,
    authorizationId: attempt.authorizationId,
    candidateHash: attempt.candidateHash,
    recoveryId: receipt.recoveryId,
    resultHash: attempt.resultHash,
    receiptHash,
  })
  if (!stored) throw new Error('read-only recovery receipt is missing after immutable insert')
  assertRecoveryReceiptRowMatches(stored, attempt, receipt)
  return recoveryReceiptProjection('PROJECTED', attempt, receipt)
}
