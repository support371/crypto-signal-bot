import { canonicalHash } from '../../canonical-json.ts'
import {
  orchestrateReviewedBitgetDemoDispatch,
  type BitgetDemoAccountDispatchSerializer,
  type BitgetDemoDispatchClock,
  type BitgetDemoDispatchOrchestrationInput,
  type ReviewedBitgetDemoDispatchOutcome,
} from './demo-dispatch-orchestrator.ts'
import type { BitgetDemoDispatchEvidenceEnv } from './demo-dispatch-evidence-store.ts'
import {
  assertBitgetDemoCandidateIntegrity,
  assertBitgetDemoDispatchAuthorizationVerified,
  BitgetDemoWriteTransport,
  type BitgetDemoDispatchResult,
  type BitgetDemoRateLimitAuthority,
  type BitgetDemoSigningMaterial,
  type VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'
import type {
  BitgetCandidateOperation,
  BitgetReadOnlyLookupInstruction,
  BitgetUnsignedMutationCandidate,
} from './execution-candidate.ts'

const VERIFIED_FRESH_CONTROL_EVIDENCE = Symbol('verified-fresh-bitget-demo-control-evidence')
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_CONTROL_EVIDENCE_AGE_MS = 2_000

interface BitgetDemoPermanentCapabilityLocks {
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

interface BitgetDemoControlEvidenceBinding extends BitgetDemoPermanentCapabilityLocks {
  schemaVersion: 1
  environment: 'BITGET_DEMO'
  exchangeAccountId: string
  candidateHash: string
  operation: BitgetCandidateOperation
  productSymbol: string
  reloadedAt: string
}

export interface BitgetDemoFreshGuardianEvidence extends BitgetDemoControlEvidenceBinding {
  evidenceType: 'GUARDIAN'
  status: 'CLEAR'
  actionAllowed: true
  stateVersionHash: string
}

export interface BitgetDemoFreshRiskEvidence extends BitgetDemoControlEvidenceBinding {
  evidenceType: 'RISK'
  decisionId: string
  configurationVersion: string
  approved: true
}

export interface BitgetDemoFreshIdempotencyEvidence extends BitgetDemoControlEvidenceBinding {
  evidenceType: 'IDEMPOTENCY'
  authorizationId: string
  dispatchAttemptId: string
  claimId: string
  idempotencyKeyHash: string
  status: 'CLAIMED'
}

export interface BitgetDemoFreshControlEvidenceInput {
  guardian: BitgetDemoFreshGuardianEvidence
  risk: BitgetDemoFreshRiskEvidence
  idempotency: BitgetDemoFreshIdempotencyEvidence
}

export interface VerifiedFreshBitgetDemoControlEvidence
  extends BitgetDemoPermanentCapabilityLocks {
  exchangeAccountId: string
  candidateHash: string
  operation: BitgetCandidateOperation
  productSymbol: string
  guardianEvidenceHash: string
  riskEvidenceHash: string
  idempotencyEvidenceHash: string
  verifiedAt: string
  guardianClear: true
  riskApproved: true
  idempotencyClaimed: true
  toJSON(): Readonly<Omit<VerifiedFreshBitgetDemoControlEvidence, 'toJSON'>>
}

export interface BitgetDemoFreshControlEvidenceLoader {
  load(input: Readonly<{
    candidate: BitgetUnsignedMutationCandidate
    authorization: VerifiedBitgetDemoDispatchAuthorization
    evaluatedAt: string
  }>): Promise<BitgetDemoFreshControlEvidenceInput>
}

export interface BitgetDemoCredentialUseRequest extends BitgetDemoPermanentCapabilityLocks {
  environment: 'BITGET_DEMO'
  exchangeAccountId: string
  candidateHash: string
  authorizationId: string
  dispatchAttemptId: string
}

export interface BitgetDemoCredentialProvider {
  withDemoSigningMaterial<T>(
    request: Readonly<BitgetDemoCredentialUseRequest>,
    use: (material: Readonly<BitgetDemoSigningMaterial>) => Promise<T>,
  ): Promise<T>
}

export interface BitgetDemoAccountRateLimitAuthorityProvider {
  forAccount(exchangeAccountId: string): Promise<BitgetDemoRateLimitAuthority>
}

export interface BitgetDemoReadOnlyRecoveryReceiptBase
  extends BitgetDemoPermanentCapabilityLocks {
  schemaVersion: 1
  recoveryId: string
  dispatchAttemptId: string
  authorizationId: string
  exchangeAccountId: string
  candidateHash: string
  resultHash: string
  lookupPlanHash: string
  lookupCount: number
  status: 'RECOVERED' | 'INCOMPLETE'
  snapshotHash: string | null
  observedAt: string
  readOnly: true
  providerMutationAllowed: false
  executionAllowed: false
  accountingAutomaticallyDispatched: false
}

export interface BitgetDemoReadOnlyRecoveryReceipt
  extends BitgetDemoReadOnlyRecoveryReceiptBase {
  receiptHash: string
}

export interface BitgetDemoReadOnlyRecoveryBoundary {
  recover(input: Readonly<{
    result: BitgetDemoDispatchResult
    resultHash: string
    lookups: readonly BitgetReadOnlyLookupInstruction[]
    lookupPlanHash: string
    requestedAt: string
  }>): Promise<BitgetDemoReadOnlyRecoveryReceipt>
}

export interface BitgetDemoCertificationRunnerDependencies {
  serializer: BitgetDemoAccountDispatchSerializer
  freshControlEvidenceLoader: BitgetDemoFreshControlEvidenceLoader
  credentialProvider: BitgetDemoCredentialProvider
  rateLimitAuthorityProvider: BitgetDemoAccountRateLimitAuthorityProvider
  recoveryBoundary: BitgetDemoReadOnlyRecoveryBoundary
  fetcher: typeof fetch
  clock?: BitgetDemoDispatchClock
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
}

export interface BitgetDemoCertificationOutcome extends BitgetDemoPermanentCapabilityLocks {
  environment: 'BITGET_DEMO'
  dispatch: ReviewedBitgetDemoDispatchOutcome
  recovery: Readonly<BitgetDemoReadOnlyRecoveryReceipt> | null
  demoCertificationOnly: true
  providerMutationAllowed: false
  executionAllowed: false
}

export class BitgetDemoCertificationRunnerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetDemoCertificationRunnerError'
    this.code = code
  }
}

const SYSTEM_CLOCK: BitgetDemoDispatchClock = Object.freeze({
  now: () => new Date(),
})

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoCertificationRunnerError('CONTROL_EVIDENCE_INVALID', `${field} is invalid`)
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_INVALID',
      `${field} must be a SHA-256 digest`,
    )
  }
  return normalized
}

function canonicalTimestamp(value: string, field: string): { value: string; milliseconds: number } {
  const normalized = String(value ?? '').trim()
  const milliseconds = Date.parse(normalized)
  if (!normalized || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_INVALID',
      `${field} must be a canonical ISO-8601 timestamp`,
    )
  }
  return { value: normalized, milliseconds }
}

function clockIso(clock: BitgetDemoDispatchClock): string {
  const value = clock.now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new BitgetDemoCertificationRunnerError(
      'CLOCK_INVALID',
      'Bitget demo certification clock must return a valid Date',
    )
  }
  return value.toISOString()
}

function productSymbol(candidate: BitgetUnsignedMutationCandidate): string {
  return requiredIdentifier(candidate.unsignedBody.symbol ?? '', 'candidate product symbol')
}

function assertPermanentLocks(value: BitgetDemoPermanentCapabilityLocks, field: string): void {
  if (
    value.liveExecutionAllowed !== false
    || value.realFundsAllowed !== false
    || value.mainnetAllowed !== false
    || value.withdrawalsAllowed !== false
    || value.automaticRetryAllowed !== false
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'CAPABILITY_LOCK_INVALID',
      `${field} violates permanent live capability locks`,
    )
  }
}

function assertFreshBinding(
  evidence: BitgetDemoControlEvidenceBinding,
  evidenceType: BitgetDemoFreshGuardianEvidence['evidenceType']
    | BitgetDemoFreshRiskEvidence['evidenceType']
    | BitgetDemoFreshIdempotencyEvidence['evidenceType'],
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  evaluatedAtMs: number,
): void {
  assertPermanentLocks(evidence, `${evidenceType} control evidence`)
  const reloadedAt = canonicalTimestamp(evidence.reloadedAt, `${evidenceType}.reloadedAt`)
  if (
    evidence.schemaVersion !== 1
    || evidence.environment !== 'BITGET_DEMO'
    || evidence.exchangeAccountId !== authorization.exchangeAccountId
    || evidence.candidateHash !== candidate.candidateHash
    || evidence.operation !== candidate.operation
    || evidence.productSymbol !== productSymbol(candidate)
    || reloadedAt.milliseconds > evaluatedAtMs
    || evaluatedAtMs - reloadedAt.milliseconds > MAX_CONTROL_EVIDENCE_AGE_MS
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_STALE_OR_MISMATCHED',
      `${evidenceType} evidence is stale or does not bind the reviewed demo candidate`,
    )
  }
}

export async function bitgetDemoControlEvidenceBindingHash(
  evidence: BitgetDemoFreshGuardianEvidence
    | BitgetDemoFreshRiskEvidence
    | BitgetDemoFreshIdempotencyEvidence,
): Promise<string> {
  const { reloadedAt: _reloadedAt, ...binding } = evidence
  return canonicalHash(binding)
}

function verifiedControlSummary(input: {
  authorization: VerifiedBitgetDemoDispatchAuthorization
  candidate: BitgetUnsignedMutationCandidate
  product: string
  guardianEvidenceHash: string
  riskEvidenceHash: string
  idempotencyEvidenceHash: string
  verifiedAt: string
}): VerifiedFreshBitgetDemoControlEvidence {
  const summary = Object.freeze({
    exchangeAccountId: input.authorization.exchangeAccountId,
    candidateHash: input.candidate.candidateHash,
    operation: input.candidate.operation,
    productSymbol: input.product,
    guardianEvidenceHash: input.guardianEvidenceHash,
    riskEvidenceHash: input.riskEvidenceHash,
    idempotencyEvidenceHash: input.idempotencyEvidenceHash,
    verifiedAt: input.verifiedAt,
    guardianClear: true as const,
    riskApproved: true as const,
    idempotencyClaimed: true as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
  const verified = {
    ...summary,
    toJSON: () => summary,
  } as VerifiedFreshBitgetDemoControlEvidence
  Object.defineProperty(verified, VERIFIED_FRESH_CONTROL_EVIDENCE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(verified)
}

export async function verifyFreshBitgetDemoControlEvidence(
  input: BitgetDemoFreshControlEvidenceInput,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  evaluatedAt: string,
): Promise<VerifiedFreshBitgetDemoControlEvidence> {
  assertBitgetDemoDispatchAuthorizationVerified(authorization)
  await assertBitgetDemoCandidateIntegrity(candidate)
  const evaluated = canonicalTimestamp(evaluatedAt, 'evaluatedAt')
  if (
    evaluated.milliseconds < Date.parse(authorization.validFrom)
    || evaluated.milliseconds >= Date.parse(authorization.expiresAt)
    || evaluated.milliseconds < Date.parse(candidate.builtAt)
    || evaluated.milliseconds >= Date.parse(candidate.expiresAt)
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_OUTSIDE_VALIDITY_WINDOW',
      'fresh control evidence was evaluated outside the candidate or authorization window',
    )
  }

  assertFreshBinding(input.guardian, 'GUARDIAN', candidate, authorization, evaluated.milliseconds)
  assertFreshBinding(input.risk, 'RISK', candidate, authorization, evaluated.milliseconds)
  assertFreshBinding(input.idempotency, 'IDEMPOTENCY', candidate, authorization, evaluated.milliseconds)
  requiredIdentifier(input.risk.decisionId, 'risk.decisionId')
  requiredIdentifier(input.risk.configurationVersion, 'risk.configurationVersion')
  requiredIdentifier(input.idempotency.claimId, 'idempotency.claimId')
  if (
    input.guardian.evidenceType !== 'GUARDIAN'
    || input.guardian.status !== 'CLEAR'
    || input.guardian.actionAllowed !== true
    || !SHA256_PATTERN.test(input.guardian.stateVersionHash)
    || input.risk.evidenceType !== 'RISK'
    || input.risk.approved !== true
    || input.idempotency.evidenceType !== 'IDEMPOTENCY'
    || input.idempotency.authorizationId !== authorization.authorizationId
    || input.idempotency.dispatchAttemptId !== authorization.dispatchAttemptId
    || input.idempotency.status !== 'CLAIMED'
    || !SHA256_PATTERN.test(input.idempotency.idempotencyKeyHash)
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_DENIED',
      'fresh Guardian, risk, or idempotency evidence does not authorize this reviewed demo attempt',
    )
  }

  const [guardianEvidenceHash, riskEvidenceHash, idempotencyEvidenceHash] = await Promise.all([
    bitgetDemoControlEvidenceBindingHash(input.guardian),
    bitgetDemoControlEvidenceBindingHash(input.risk),
    bitgetDemoControlEvidenceBindingHash(input.idempotency),
  ])
  if (
    guardianEvidenceHash !== authorization.guardianEvidenceHash
    || riskEvidenceHash !== authorization.riskEvidenceHash
    || idempotencyEvidenceHash !== authorization.idempotencyEvidenceHash
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_HASH_MISMATCH',
      'fresh control evidence no longer matches the independently reviewed authorization',
    )
  }
  return verifiedControlSummary({
    authorization,
    candidate,
    product: productSymbol(candidate),
    guardianEvidenceHash,
    riskEvidenceHash,
    idempotencyEvidenceHash,
    verifiedAt: evaluated.value,
  })
}

export function assertFreshBitgetDemoControlEvidenceVerified(
  value: VerifiedFreshBitgetDemoControlEvidence,
): asserts value is VerifiedFreshBitgetDemoControlEvidence {
  if ((value as unknown as Record<symbol, unknown>)[VERIFIED_FRESH_CONTROL_EVIDENCE] !== true) {
    throw new BitgetDemoCertificationRunnerError(
      'CONTROL_EVIDENCE_NOT_VERIFIED',
      'Bitget demo certification requires freshly reloaded and in-memory verified control evidence',
    )
  }
}

function credentialUseRequest(
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
): Readonly<BitgetDemoCredentialUseRequest> {
  return Object.freeze({
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: authorization.exchangeAccountId,
    candidateHash: candidate.candidateHash,
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
}

function assertResultBinding(
  result: BitgetDemoDispatchResult,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
): void {
  assertPermanentLocks(result, 'Bitget demo dispatch result')
  if (
    result.environment !== 'BITGET_DEMO'
    || result.dispatchAttemptId !== authorization.dispatchAttemptId
    || result.authorizationId !== authorization.authorizationId
    || result.exchangeAccountId !== authorization.exchangeAccountId
    || result.candidateHash !== candidate.candidateHash
    || result.operation !== candidate.operation
    || result.endpoint !== candidate.endpoint
    || result.realProviderMutationAllowed !== false
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'DISPATCH_RESULT_MISMATCH',
      'demo transport result does not bind the reviewed candidate and permanent capability locks',
    )
  }
}

export function createBitgetDemoCertificationExecutor(
  dependencies: BitgetDemoCertificationRunnerDependencies,
): Readonly<{
  serializer: BitgetDemoAccountDispatchSerializer
  dispatch(
    candidate: BitgetUnsignedMutationCandidate,
    authorization: VerifiedBitgetDemoDispatchAuthorization,
  ): Promise<BitgetDemoDispatchResult>
}> {
  if (!dependencies.serializer || typeof dependencies.serializer.run !== 'function') {
    throw new BitgetDemoCertificationRunnerError('SERIALIZER_REQUIRED', 'account serializer is required')
  }
  if (!dependencies.freshControlEvidenceLoader || typeof dependencies.freshControlEvidenceLoader.load !== 'function') {
    throw new BitgetDemoCertificationRunnerError('CONTROL_LOADER_REQUIRED', 'fresh control evidence loader is required')
  }
  if (!dependencies.credentialProvider || typeof dependencies.credentialProvider.withDemoSigningMaterial !== 'function') {
    throw new BitgetDemoCertificationRunnerError('CREDENTIAL_PROVIDER_REQUIRED', 'demo credential provider is required')
  }
  if (!dependencies.rateLimitAuthorityProvider || typeof dependencies.rateLimitAuthorityProvider.forAccount !== 'function') {
    throw new BitgetDemoCertificationRunnerError('RATE_LIMIT_PROVIDER_REQUIRED', 'account rate authority provider is required')
  }
  if (!dependencies.recoveryBoundary || typeof dependencies.recoveryBoundary.recover !== 'function') {
    throw new BitgetDemoCertificationRunnerError(
      'READ_ONLY_RECOVERY_REQUIRED',
      'an injected read-only recovery boundary is required before any demo attempt',
    )
  }
  if (typeof dependencies.fetcher !== 'function') {
    throw new BitgetDemoCertificationRunnerError('FETCHER_REQUIRED', 'an injected demo fetcher is required')
  }
  const clock = dependencies.clock ?? SYSTEM_CLOCK

  return Object.freeze({
    serializer: dependencies.serializer,
    dispatch: async (
      candidate: BitgetUnsignedMutationCandidate,
      authorization: VerifiedBitgetDemoDispatchAuthorization,
    ): Promise<BitgetDemoDispatchResult> => {
      const evaluatedAt = clockIso(clock)
      const reloaded = await dependencies.freshControlEvidenceLoader.load(Object.freeze({
        candidate,
        authorization,
        evaluatedAt,
      }))
      const verified = await verifyFreshBitgetDemoControlEvidence(
        reloaded,
        candidate,
        authorization,
        evaluatedAt,
      )
      assertFreshBitgetDemoControlEvidenceVerified(verified)

      const rateLimitAuthority = await dependencies.rateLimitAuthorityProvider.forAccount(
        authorization.exchangeAccountId,
      )
      if (!rateLimitAuthority || typeof rateLimitAuthority.claim !== 'function') {
        throw new BitgetDemoCertificationRunnerError(
          'RATE_LIMIT_AUTHORITY_REQUIRED',
          'account rate authority provider returned no usable authority',
        )
      }
      const transport = new BitgetDemoWriteTransport({
        fetcher: dependencies.fetcher,
        rateLimitAuthority,
        now: () => clock.now().getTime(),
        timeoutMs: dependencies.timeoutMs,
        maxRequestBytes: dependencies.maxRequestBytes,
        maxResponseBytes: dependencies.maxResponseBytes,
      })

      let materialUseCount = 0
      let materialLeaseActive = true
      let result: BitgetDemoDispatchResult
      try {
        result = await dependencies.credentialProvider.withDemoSigningMaterial(
          credentialUseRequest(candidate, authorization),
          async (material) => {
            if (!materialLeaseActive || materialUseCount !== 0) {
              throw new BitgetDemoCertificationRunnerError(
                'CREDENTIAL_LEASE_REUSED',
                'demo signing material may be consumed exactly once while its callback is active',
              )
            }
            materialUseCount = 1
            return transport.dispatch(candidate, authorization, material)
          },
        )
      } finally {
        materialLeaseActive = false
      }
      if (materialUseCount !== 1) {
        throw new BitgetDemoCertificationRunnerError(
          'CREDENTIAL_LEASE_UNUSED',
          'demo credential provider did not execute its callback exactly once',
        )
      }
      assertResultBinding(result, candidate, authorization)
      return result
    },
  })
}

function normalizeRecoveryReceipt(
  receipt: BitgetDemoReadOnlyRecoveryReceipt,
): BitgetDemoReadOnlyRecoveryReceipt {
  const normalized = Object.freeze({
    schemaVersion: receipt.schemaVersion,
    recoveryId: requiredIdentifier(receipt.recoveryId, 'recoveryId'),
    dispatchAttemptId: requiredIdentifier(receipt.dispatchAttemptId, 'dispatchAttemptId'),
    authorizationId: requiredIdentifier(receipt.authorizationId, 'authorizationId'),
    exchangeAccountId: requiredIdentifier(receipt.exchangeAccountId, 'exchangeAccountId'),
    candidateHash: requiredHash(receipt.candidateHash, 'candidateHash'),
    resultHash: requiredHash(receipt.resultHash, 'resultHash'),
    lookupPlanHash: requiredHash(receipt.lookupPlanHash, 'lookupPlanHash'),
    lookupCount: receipt.lookupCount,
    status: receipt.status,
    snapshotHash: receipt.snapshotHash === null ? null : requiredHash(receipt.snapshotHash, 'snapshotHash'),
    observedAt: canonicalTimestamp(receipt.observedAt, 'recovery observedAt').value,
    readOnly: receipt.readOnly,
    providerMutationAllowed: receipt.providerMutationAllowed,
    executionAllowed: receipt.executionAllowed,
    accountingAutomaticallyDispatched: receipt.accountingAutomaticallyDispatched,
    liveExecutionAllowed: receipt.liveExecutionAllowed,
    realFundsAllowed: receipt.realFundsAllowed,
    mainnetAllowed: receipt.mainnetAllowed,
    withdrawalsAllowed: receipt.withdrawalsAllowed,
    automaticRetryAllowed: receipt.automaticRetryAllowed,
  })
  return Object.freeze({ ...normalized, receiptHash: requiredHash(receipt.receiptHash, 'receiptHash') })
}

export async function recoverReviewedBitgetDemoDispatch(
  outcome: ReviewedBitgetDemoDispatchOutcome,
  boundary: BitgetDemoReadOnlyRecoveryBoundary,
  clock: BitgetDemoDispatchClock = SYSTEM_CLOCK,
): Promise<Readonly<BitgetDemoReadOnlyRecoveryReceipt> | null> {
  if (!outcome.result.requiresReadOnlyRecovery) return null
  if (!boundary || typeof boundary.recover !== 'function') {
    throw new BitgetDemoCertificationRunnerError(
      'READ_ONLY_RECOVERY_REQUIRED',
      'ambiguous demo result requires an injected read-only recovery boundary',
    )
  }
  if (
    outcome.result.recoveryLookups.length < 1
    || outcome.result.recoveryLookups.length > 2
    || outcome.persistence.resultHash !== await canonicalHash(outcome.result)
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'RECOVERY_BINDING_INVALID',
      'persisted demo result or its read-only lookup plan is invalid',
    )
  }

  const lookupPlanHash = await canonicalHash(outcome.result.recoveryLookups)
  const requestedAt = clockIso(clock)
  const returned = await boundary.recover(Object.freeze({
    result: outcome.result,
    resultHash: outcome.persistence.resultHash,
    lookups: outcome.result.recoveryLookups,
    lookupPlanHash,
    requestedAt,
  }))
  const receipt = normalizeRecoveryReceipt(returned)
  assertPermanentLocks(receipt, 'read-only recovery receipt')
  const observedAtMs = Date.parse(receipt.observedAt)
  const verifiedAtMs = Date.parse(clockIso(clock))
  if (
    receipt.schemaVersion !== 1
    || receipt.dispatchAttemptId !== outcome.result.dispatchAttemptId
    || receipt.authorizationId !== outcome.result.authorizationId
    || receipt.exchangeAccountId !== outcome.result.exchangeAccountId
    || receipt.candidateHash !== outcome.result.candidateHash
    || receipt.resultHash !== outcome.persistence.resultHash
    || receipt.lookupPlanHash !== lookupPlanHash
    || receipt.lookupCount !== outcome.result.recoveryLookups.length
    || (receipt.status !== 'RECOVERED' && receipt.status !== 'INCOMPLETE')
    || (receipt.status === 'RECOVERED') !== (receipt.snapshotHash !== null)
    || receipt.readOnly !== true
    || receipt.providerMutationAllowed !== false
    || receipt.executionAllowed !== false
    || receipt.accountingAutomaticallyDispatched !== false
    || observedAtMs < Date.parse(requestedAt)
    || observedAtMs > verifiedAtMs
  ) {
    throw new BitgetDemoCertificationRunnerError(
      'RECOVERY_RECEIPT_INVALID',
      'read-only recovery receipt conflicts with the persisted ambiguous demo result',
    )
  }
  const { receiptHash, ...base } = receipt
  if (await canonicalHash(base) !== receiptHash) {
    throw new BitgetDemoCertificationRunnerError(
      'RECOVERY_RECEIPT_HASH_MISMATCH',
      'read-only recovery receipt hash is invalid',
    )
  }
  return receipt
}

/**
 * Source-only non-public demo certification composition.
 *
 * The reviewed authorization and immutable one-shot claim are handled by the
 * existing orchestrator. Fresh Guardian, risk, and idempotency evidence is
 * reloaded only after that claim and immediately before callback-scoped demo
 * signing material is used. Any uncertain result is persisted first and then
 * sent once to an injected GET-only recovery boundary. There is no retry,
 * route, binding, default fetcher, credential implementation, or live mode.
 */
export async function runReviewedBitgetDemoCertification(
  env: BitgetDemoDispatchEvidenceEnv,
  input: BitgetDemoDispatchOrchestrationInput,
  dependencies: BitgetDemoCertificationRunnerDependencies,
): Promise<BitgetDemoCertificationOutcome> {
  const clock = dependencies.clock ?? SYSTEM_CLOCK
  const dispatch = await orchestrateReviewedBitgetDemoDispatch(
    env,
    input,
    createBitgetDemoCertificationExecutor(dependencies),
    clock,
  )
  const recovery = await recoverReviewedBitgetDemoDispatch(
    dispatch,
    dependencies.recoveryBoundary,
    clock,
  )
  return Object.freeze({
    environment: 'BITGET_DEMO' as const,
    dispatch,
    recovery,
    demoCertificationOnly: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
}
