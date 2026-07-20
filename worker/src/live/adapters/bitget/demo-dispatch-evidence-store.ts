import { canonicalHash, canonicalJson } from '../../canonical-json.ts'
import {
  assertBitgetDemoCandidateIntegrity,
  assertBitgetDemoDispatchAuthorizationVerified,
  verifyBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchAuthorizationInput,
  type BitgetDemoDispatchResult,
  type VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'
import {
  BITGET_MUTATION_EVIDENCE_ENDPOINTS,
  type BitgetCandidateOperation,
  type BitgetReadOnlyLookupInstruction,
  type BitgetUnsignedMutationCandidate,
} from './execution-candidate.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PRODUCT_SYMBOL_PATTERN = /^[A-Z0-9]{2,32}$/
const REVIEW_ACTION = 'BITGET_DEMO_DISPATCH'
const REVIEW_RESOURCE_TYPE = 'BITGET_DEMO_CANDIDATE'
const GENESIS_RESULT = 'NO_RESULT'

export interface BitgetDemoDispatchEvidenceEnv {
  DB: D1Database
}

export interface BitgetDemoAuthorizationProjectionReceipt {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  authorizationId: string
  dispatchAttemptId: string
  candidateHash: string
  authorizationHash: string
  environment: 'BITGET_DEMO'
  automaticallyRetried: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}

export interface LoadedReviewedBitgetDemoAuthorization {
  authorization: VerifiedBitgetDemoDispatchAuthorization
  authorizationHash: string
  operation: BitgetCandidateOperation
  endpoint: string
  productSymbol: string
  reviewedAt: string
  environment: 'BITGET_DEMO'
  automaticallyRetried: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}

export interface BitgetDemoDispatchClaim {
  dispatchAttemptId: string
  authorizationId: string
  exchangeAccountId: string
  candidateHash: string
  authorizationHash: string
  predecessorResultId: typeof GENESIS_RESULT
  claimHash: string
  claimedAt: string
  oneShot: true
  demoDispatchReviewed: true
  requiresAccountCoordinatorSerialization: true
  automaticallyRetried: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}

export interface BitgetDemoDispatchResultProjectionReceipt {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  dispatchAttemptId: string
  authorizationId: string
  candidateHash: string
  resultHash: string
  category: BitgetDemoDispatchResult['category']
  recoveryLookupCount: number
  demoRequestSent: boolean
  requiresReadOnlyRecovery: boolean
  realProviderMutationAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticallyRetried: false
}

type AuthorizationContextRow = {
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
  audit_event_hash: string
  occurred_at: string
  step_up_actor_id: string | null
  assurance_level: 'AAL2' | 'AAL3' | null
  audience: string | null
  issued_at: string | null
  step_up_expires_at: string | null
  revoked_at: string | null
  session_hash: string | null
}

type AuthorizationRow = {
  authorization_id: string
  dispatch_attempt_id: string
  exchange_account_id: string
  candidate_hash: string
  operation: BitgetCandidateOperation
  endpoint: string
  product_symbol: string
  actor_id: string
  preparer_id: string
  authorization_evidence_hash: string
  step_up_evidence_hash: string
  risk_evidence_hash: string
  guardian_evidence_hash: string
  idempotency_evidence_hash: string
  valid_from: string
  expires_at: string
  validity_seconds: number
  authorization_hash: string
  environment: string
  account_coordinator_serialized: number
  guardian_clear: number
  risk_approved: number
  idempotency_claimed: number
  demo_mutation_reviewed: number
  live_release_present: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatically_retried: number
  reviewed_at: string
}

type ClaimRow = {
  dispatch_attempt_id: string
  authorization_id: string
  exchange_account_id: string
  candidate_hash: string
  authorization_hash: string
  claim_hash: string
  one_shot: number
  demo_dispatch_reviewed: number
  requires_account_coordinator_serialization: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatically_retried: number
  claimed_at: string
}

type ResultRow = {
  dispatch_attempt_id: string
  authorization_id: string
  exchange_account_id: string
  candidate_hash: string
  operation: BitgetCandidateOperation
  endpoint: string
  category: BitgetDemoDispatchResult['category']
  reason: string
  request_body_hash: string | null
  rate_limit_receipt_hash: string | null
  http_status: number | null
  provider_code: string | null
  provider_message: string | null
  acknowledged_order_id: string | null
  acknowledged_client_order_id: string | null
  recovery_lookup_count: number
  result_json: string
  result_hash: string
  environment: string
  demo_request_sent: number
  demo_provider_mutation_attempted: number
  requires_read_only_recovery: number
  provider_acknowledgment_verified: number
  real_provider_mutation_allowed: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatically_retried: number
  occurred_at: string
}

type LookupRow = {
  lookup_index: number
  method: string
  endpoint: string
  product_symbol: string
  order_id: string | null
  client_order_id: string | null
  lookup_hash: string
  provider_mutation_allowed: number
  live_execution_allowed: number
  automatically_dispatched: number
}

export class BitgetDemoDispatchEvidenceConflictError extends Error {
  readonly code = 'BITGET_DEMO_DISPATCH_EVIDENCE_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetDemoDispatchEvidenceConflictError'
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoDispatchEvidenceConflictError(`${field} is invalid`)
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new BitgetDemoDispatchEvidenceConflictError(`${field} must be a SHA-256 digest`)
  }
  return normalized
}

function requiredIso(value: string, field: string): string {
  const parsed = Date.parse(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) {
    throw new BitgetDemoDispatchEvidenceConflictError(`${field} must be ISO-8601`)
  }
  return new Date(parsed).toISOString()
}

function requiredProductSymbol(value: string): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!PRODUCT_SYMBOL_PATTERN.test(normalized)) {
    throw new BitgetDemoDispatchEvidenceConflictError('candidate product symbol is invalid')
  }
  return normalized
}

function parseRoleArray(value: string, field: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new BitgetDemoDispatchEvidenceConflictError(`${field} is not valid JSON`)
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.some((role) => typeof role !== 'string' || !IDENTIFIER_PATTERN.test(role))
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(`${field} is not a non-empty role list`)
  }
  return Object.freeze(parsed)
}

function productSymbol(candidate: BitgetUnsignedMutationCandidate): string {
  return requiredProductSymbol(candidate.unsignedBody.symbol ?? '')
}

function assertAuthorizationRowCapabilities(row: AuthorizationRow): void {
  if (
    row.environment !== 'BITGET_DEMO'
    || row.account_coordinator_serialized !== 1
    || row.guardian_clear !== 1
    || row.risk_approved !== 1
    || row.idempotency_claimed !== 1
    || row.demo_mutation_reviewed !== 1
    || row.live_release_present !== 0
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatically_retried !== 0
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo authorization violates permanent capability locks',
    )
  }
}

function assertClaimRowCapabilities(row: ClaimRow): void {
  if (
    row.one_shot !== 1
    || row.demo_dispatch_reviewed !== 1
    || row.requires_account_coordinator_serialization !== 1
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatically_retried !== 0
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo dispatch claim violates one-shot capability locks',
    )
  }
}

function assertResultRowCapabilities(row: ResultRow): void {
  if (
    row.environment !== 'BITGET_DEMO'
    || row.real_provider_mutation_allowed !== 0
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatically_retried !== 0
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo dispatch result violates permanent capability locks',
    )
  }
}

async function loadAuthorizationContext(
  env: BitgetDemoDispatchEvidenceEnv,
  authorizationId: string,
): Promise<AuthorizationContextRow> {
  const row = await env.DB.prepare(`
    SELECT authorization.authorization_event_id, authorization.actor_id,
           authorization.action, authorization.resource_type,
           authorization.resource_id, authorization.required_roles_json,
           authorization.actor_roles_json, authorization.step_up_required,
           authorization.step_up_session_id, authorization.decision,
           authorization.audit_event_hash, authorization.occurred_at,
           step_up.actor_id AS step_up_actor_id,
           step_up.assurance_level, step_up.audience, step_up.issued_at,
           step_up.expires_at AS step_up_expires_at, step_up.revoked_at,
           step_up.session_hash
      FROM live_authorization_events authorization
      LEFT JOIN live_step_up_sessions step_up
        ON step_up.step_up_session_id = authorization.step_up_session_id
     WHERE authorization.authorization_event_id = ?
     LIMIT 1
  `).bind(authorizationId).first<AuthorizationContextRow>()
  if (!row) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'independent Bitget demo authorization evidence is missing',
    )
  }
  return row
}

function assertAuthorizationContext(
  row: AuthorizationContextRow,
  input: Readonly<BitgetDemoDispatchAuthorizationInput>,
  reviewedAt: string,
): void {
  const requiredRoles = parseRoleArray(row.required_roles_json, 'required roles')
  const actorRoles = parseRoleArray(row.actor_roles_json, 'actor roles')
  const hasRiskReview = actorRoles.includes('RISK_OPERATOR') || actorRoles.includes('RISK_ADMIN')
  const requiresRiskReview = requiredRoles.includes('RISK_OPERATOR') || requiredRoles.includes('RISK_ADMIN')
  if (
    row.authorization_event_id !== input.authorizationId
    || row.actor_id !== input.actorId
    || row.action !== REVIEW_ACTION
    || row.resource_type !== REVIEW_RESOURCE_TYPE
    || row.resource_id !== input.candidateHash
    || row.decision !== 'ALLOW'
    || row.step_up_required !== 1
    || row.step_up_session_id === null
    || requiredHash(row.audit_event_hash, 'authorization audit hash') !== input.authorizationEvidenceHash
    || !hasRiskReview
    || !requiresRiskReview
    || row.step_up_actor_id !== input.actorId
    || (row.assurance_level !== 'AAL2' && row.assurance_level !== 'AAL3')
    || row.audience !== REVIEW_ACTION
    || row.revoked_at !== null
    || row.session_hash === null
    || requiredHash(row.session_hash, 'step-up session hash') !== input.stepUpEvidenceHash
    || row.issued_at === null
    || row.step_up_expires_at === null
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo authorization does not satisfy independent role and step-up review',
    )
  }
  const occurredAtMs = Date.parse(requiredIso(row.occurred_at, 'authorization occurredAt'))
  const issuedAtMs = Date.parse(requiredIso(row.issued_at, 'step-up issuedAt'))
  const sessionExpiresAtMs = Date.parse(requiredIso(row.step_up_expires_at, 'step-up expiresAt'))
  const reviewedAtMs = Date.parse(reviewedAt)
  const validFromMs = Date.parse(input.validFrom)
  const expiresAtMs = Date.parse(input.expiresAt)
  if (
    issuedAtMs > occurredAtMs
    || occurredAtMs > reviewedAtMs
    || occurredAtMs > validFromMs
    || reviewedAtMs >= expiresAtMs
    || sessionExpiresAtMs < expiresAtMs
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo review timing is inconsistent with authorization and step-up evidence',
    )
  }
}

function authorizationInputFromRow(row: AuthorizationRow): BitgetDemoDispatchAuthorizationInput {
  return {
    authorizationId: row.authorization_id,
    dispatchAttemptId: row.dispatch_attempt_id,
    exchangeAccountId: row.exchange_account_id,
    actorId: row.actor_id,
    preparerId: row.preparer_id,
    candidateHash: row.candidate_hash,
    authorizationEvidenceHash: row.authorization_evidence_hash,
    stepUpEvidenceHash: row.step_up_evidence_hash,
    riskEvidenceHash: row.risk_evidence_hash,
    guardianEvidenceHash: row.guardian_evidence_hash,
    idempotencyEvidenceHash: row.idempotency_evidence_hash,
    validFrom: row.valid_from,
    expiresAt: row.expires_at,
    environment: 'BITGET_DEMO',
    accountCoordinatorSerialized: true,
    guardianClear: true,
    riskApproved: true,
    idempotencyClaimed: true,
    demoMutationReviewed: true,
    liveReleasePresent: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
  }
}

async function expectedAuthorizationHash(input: {
  authorization: Readonly<BitgetDemoDispatchAuthorizationInput>
  operation: BitgetCandidateOperation
  endpoint: string
  productSymbol: string
  reviewedAt: string
}): Promise<string> {
  return canonicalHash({
    ...input,
    environment: 'BITGET_DEMO',
    automaticallyRetried: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

async function loadAuthorizationRow(
  env: BitgetDemoDispatchEvidenceEnv,
  authorizationId: string,
  dispatchAttemptId: string,
  candidateHash: string,
  authorizationHash?: string,
): Promise<AuthorizationRow | null> {
  return env.DB.prepare(`
    SELECT authorization_id, dispatch_attempt_id, exchange_account_id,
           candidate_hash, operation, endpoint, product_symbol, actor_id,
           preparer_id, authorization_evidence_hash, step_up_evidence_hash,
           risk_evidence_hash, guardian_evidence_hash,
           idempotency_evidence_hash, valid_from, expires_at,
           validity_seconds, authorization_hash, environment,
           account_coordinator_serialized, guardian_clear, risk_approved,
           idempotency_claimed, demo_mutation_reviewed, live_release_present,
           live_execution_allowed, real_funds_allowed, mainnet_allowed,
           withdrawals_allowed, automatically_retried, reviewed_at
      FROM live_bitget_demo_dispatch_authorizations
     WHERE authorization_id = ? OR dispatch_attempt_id = ?
        OR candidate_hash = ? OR authorization_hash = ?
     LIMIT 1
  `).bind(
    authorizationId,
    dispatchAttemptId,
    candidateHash,
    authorizationHash ?? '',
  ).first<AuthorizationRow>()
}

function assertAuthorizationRow(
  row: AuthorizationRow,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  candidate: BitgetUnsignedMutationCandidate,
  authorizationHash: string,
  reviewedAt: string,
): void {
  assertAuthorizationRowCapabilities(row)
  if (
    row.valid_from !== requiredIso(row.valid_from, 'stored validFrom')
    || row.expires_at !== requiredIso(row.expires_at, 'stored expiresAt')
    || row.reviewed_at !== requiredIso(row.reviewed_at, 'stored reviewedAt')
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo authorization timestamps are not canonical',
    )
  }
  const validitySeconds = (Date.parse(authorization.expiresAt) - Date.parse(authorization.validFrom)) / 1000
  if (
    row.authorization_id !== authorization.authorizationId
    || row.dispatch_attempt_id !== authorization.dispatchAttemptId
    || row.exchange_account_id !== authorization.exchangeAccountId
    || row.candidate_hash !== candidate.candidateHash
    || row.operation !== candidate.operation
    || row.endpoint !== candidate.endpoint
    || row.product_symbol !== productSymbol(candidate)
    || row.actor_id !== authorization.actorId
    || row.preparer_id !== authorization.preparerId
    || row.authorization_evidence_hash !== authorization.authorizationEvidenceHash
    || row.step_up_evidence_hash !== authorization.stepUpEvidenceHash
    || row.risk_evidence_hash !== authorization.riskEvidenceHash
    || row.guardian_evidence_hash !== authorization.guardianEvidenceHash
    || row.idempotency_evidence_hash !== authorization.idempotencyEvidenceHash
    || row.valid_from !== authorization.validFrom
    || row.expires_at !== authorization.expiresAt
    || row.validity_seconds !== validitySeconds
    || row.authorization_hash !== authorizationHash
    || row.reviewed_at !== reviewedAt
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo authorization conflicts with reviewed evidence',
    )
  }
}

function authorizationProjection(
  projectionStatus: BitgetDemoAuthorizationProjectionReceipt['projectionStatus'],
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  authorizationHash: string,
): BitgetDemoAuthorizationProjectionReceipt {
  return Object.freeze({
    projectionStatus,
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    candidateHash: authorization.candidateHash,
    authorizationHash,
    environment: 'BITGET_DEMO',
    automaticallyRetried: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

export async function recordReviewedBitgetDemoDispatchAuthorization(
  env: BitgetDemoDispatchEvidenceEnv,
  candidate: BitgetUnsignedMutationCandidate,
  input: BitgetDemoDispatchAuthorizationInput,
  reviewedAt: string,
): Promise<BitgetDemoAuthorizationProjectionReceipt> {
  await assertBitgetDemoCandidateIntegrity(candidate)
  const authorization = verifyBitgetDemoDispatchAuthorization(input)
  const normalizedReviewedAt = requiredIso(reviewedAt, 'reviewedAt')
  if (
    authorization.validFrom !== requiredIso(authorization.validFrom, 'validFrom')
    || authorization.expiresAt !== requiredIso(authorization.expiresAt, 'expiresAt')
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo authorization timestamps must use canonical UTC ISO-8601',
    )
  }
  const validityMs = Date.parse(authorization.expiresAt) - Date.parse(authorization.validFrom)
  if (validityMs % 1000 !== 0) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo authorization validity must use whole seconds',
    )
  }
  const context = await loadAuthorizationContext(env, authorization.authorizationId)
  assertAuthorizationContext(context, authorization.toJSON(), normalizedReviewedAt)
  const symbol = productSymbol(candidate)
  const authorizationHash = await expectedAuthorizationHash({
    authorization: authorization.toJSON(),
    operation: candidate.operation,
    endpoint: candidate.endpoint,
    productSymbol: symbol,
    reviewedAt: normalizedReviewedAt,
  })
  const existing = await loadAuthorizationRow(
    env,
    authorization.authorizationId,
    authorization.dispatchAttemptId,
    candidate.candidateHash,
    authorizationHash,
  )
  if (existing) {
    assertAuthorizationRow(
      existing,
      authorization,
      candidate,
      authorizationHash,
      normalizedReviewedAt,
    )
    return authorizationProjection('REPLAYED', authorization, authorizationHash)
  }

  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_dispatch_authorizations (
        authorization_id, dispatch_attempt_id, exchange_account_id,
        candidate_hash, operation, endpoint, product_symbol, actor_id,
        preparer_id, authorization_evidence_hash, step_up_evidence_hash,
        risk_evidence_hash, guardian_evidence_hash,
        idempotency_evidence_hash, valid_from, expires_at, validity_seconds,
        authorization_hash, environment, account_coordinator_serialized,
        guardian_clear, risk_approved, idempotency_claimed,
        demo_mutation_reviewed, live_release_present, live_execution_allowed,
        real_funds_allowed, mainnet_allowed, withdrawals_allowed,
        automatically_retried, reviewed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'BITGET_DEMO', 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, ?
      )
    `).bind(
      authorization.authorizationId,
      authorization.dispatchAttemptId,
      authorization.exchangeAccountId,
      candidate.candidateHash,
      candidate.operation,
      candidate.endpoint,
      symbol,
      authorization.actorId,
      authorization.preparerId,
      authorization.authorizationEvidenceHash,
      authorization.stepUpEvidenceHash,
      authorization.riskEvidenceHash,
      authorization.guardianEvidenceHash,
      authorization.idempotencyEvidenceHash,
      authorization.validFrom,
      authorization.expiresAt,
      validityMs / 1000,
      authorizationHash,
      normalizedReviewedAt,
    ).run()
  } catch {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo authorization record was rejected',
    )
  }
  const stored = await loadAuthorizationRow(
    env,
    authorization.authorizationId,
    authorization.dispatchAttemptId,
    candidate.candidateHash,
    authorizationHash,
  )
  if (!stored) throw new Error('Bitget demo authorization is missing after immutable insert')
  assertAuthorizationRow(stored, authorization, candidate, authorizationHash, normalizedReviewedAt)
  return authorizationProjection('PROJECTED', authorization, authorizationHash)
}

export async function loadReviewedBitgetDemoDispatchAuthorization(
  env: BitgetDemoDispatchEvidenceEnv,
  candidate: BitgetUnsignedMutationCandidate,
  authorizationId: string,
  dispatchAttemptId: string,
  evaluatedAt: string,
): Promise<LoadedReviewedBitgetDemoAuthorization> {
  await assertBitgetDemoCandidateIntegrity(candidate)
  const normalizedAuthorizationId = requiredIdentifier(authorizationId, 'authorizationId')
  const normalizedAttemptId = requiredIdentifier(dispatchAttemptId, 'dispatchAttemptId')
  const row = await loadAuthorizationRow(
    env,
    normalizedAuthorizationId,
    normalizedAttemptId,
    candidate.candidateHash,
  )
  if (!row) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'reviewed Bitget demo authorization is missing',
    )
  }
  assertAuthorizationRowCapabilities(row)
  if (
    row.authorization_id !== normalizedAuthorizationId
    || row.dispatch_attempt_id !== normalizedAttemptId
    || row.candidate_hash !== candidate.candidateHash
    || row.operation !== candidate.operation
    || row.endpoint !== candidate.endpoint
    || row.product_symbol !== productSymbol(candidate)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'reviewed Bitget demo authorization does not match the requested candidate',
    )
  }
  const input = authorizationInputFromRow(row)
  const authorization = verifyBitgetDemoDispatchAuthorization(input)
  const context = await loadAuthorizationContext(env, row.authorization_id)
  assertAuthorizationContext(context, authorization.toJSON(), row.reviewed_at)
  const expectedHash = await expectedAuthorizationHash({
    authorization: authorization.toJSON(),
    operation: row.operation,
    endpoint: row.endpoint,
    productSymbol: row.product_symbol,
    reviewedAt: row.reviewed_at,
  })
  assertAuthorizationRow(row, authorization, candidate, expectedHash, row.reviewed_at)

  const evaluatedAtMs = Date.parse(requiredIso(evaluatedAt, 'evaluatedAt'))
  if (
    evaluatedAtMs < Date.parse(authorization.validFrom)
    || evaluatedAtMs >= Date.parse(authorization.expiresAt)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'reviewed Bitget demo authorization is outside its immutable validity window',
    )
  }
  return Object.freeze({
    authorization,
    authorizationHash: expectedHash,
    operation: row.operation,
    endpoint: row.endpoint,
    productSymbol: row.product_symbol,
    reviewedAt: row.reviewed_at,
    environment: 'BITGET_DEMO',
    automaticallyRetried: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

async function expectedClaimHash(
  reviewed: LoadedReviewedBitgetDemoAuthorization,
  claimedAt: string,
): Promise<string> {
  return canonicalHash({
    dispatchAttemptId: reviewed.authorization.dispatchAttemptId,
    authorizationId: reviewed.authorization.authorizationId,
    exchangeAccountId: reviewed.authorization.exchangeAccountId,
    candidateHash: reviewed.authorization.candidateHash,
    authorizationHash: reviewed.authorizationHash,
    predecessorResultId: GENESIS_RESULT,
    claimedAt,
    oneShot: true,
    demoDispatchReviewed: true,
    requiresAccountCoordinatorSerialization: true,
    automaticallyRetried: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

async function loadClaimRow(
  env: BitgetDemoDispatchEvidenceEnv,
  dispatchAttemptId: string,
  authorizationId: string,
  candidateHash: string,
  claimHash?: string,
): Promise<ClaimRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_attempt_id, authorization_id, exchange_account_id,
           candidate_hash, authorization_hash, claim_hash, one_shot,
           demo_dispatch_reviewed, requires_account_coordinator_serialization,
           live_execution_allowed, real_funds_allowed, mainnet_allowed,
           withdrawals_allowed, automatically_retried, claimed_at
      FROM live_bitget_demo_dispatch_claims
     WHERE dispatch_attempt_id = ? OR authorization_id = ?
        OR candidate_hash = ? OR claim_hash = ?
     LIMIT 1
  `).bind(
    dispatchAttemptId,
    authorizationId,
    candidateHash,
    claimHash ?? '',
  ).first<ClaimRow>()
}

function claimFromRow(row: ClaimRow): BitgetDemoDispatchClaim {
  assertClaimRowCapabilities(row)
  return Object.freeze({
    dispatchAttemptId: row.dispatch_attempt_id,
    authorizationId: row.authorization_id,
    exchangeAccountId: row.exchange_account_id,
    candidateHash: row.candidate_hash,
    authorizationHash: row.authorization_hash,
    predecessorResultId: GENESIS_RESULT,
    claimHash: row.claim_hash,
    claimedAt: row.claimed_at,
    oneShot: true,
    demoDispatchReviewed: true,
    requiresAccountCoordinatorSerialization: true,
    automaticallyRetried: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

function assertClaimMatches(
  claim: BitgetDemoDispatchClaim,
  reviewed: LoadedReviewedBitgetDemoAuthorization,
  expectedHash: string,
  claimedAt: string,
): void {
  if (
    claim.dispatchAttemptId !== reviewed.authorization.dispatchAttemptId
    || claim.authorizationId !== reviewed.authorization.authorizationId
    || claim.exchangeAccountId !== reviewed.authorization.exchangeAccountId
    || claim.candidateHash !== reviewed.authorization.candidateHash
    || claim.authorizationHash !== reviewed.authorizationHash
    || claim.claimHash !== expectedHash
    || claim.claimedAt !== claimedAt
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo one-shot claim conflicts with reviewed authorization',
    )
  }
}

export async function claimReviewedBitgetDemoDispatchAttempt(
  env: BitgetDemoDispatchEvidenceEnv,
  reviewed: LoadedReviewedBitgetDemoAuthorization,
  claimedAt: string,
): Promise<BitgetDemoDispatchClaim> {
  assertBitgetDemoDispatchAuthorizationVerified(reviewed.authorization)
  const normalizedClaimedAt = requiredIso(claimedAt, 'claimedAt')
  const claimedAtMs = Date.parse(normalizedClaimedAt)
  if (
    claimedAtMs < Date.parse(reviewed.authorization.validFrom)
    || claimedAtMs >= Date.parse(reviewed.authorization.expiresAt)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo one-shot claim is outside the reviewed validity window',
    )
  }
  const claimHash = await expectedClaimHash(reviewed, normalizedClaimedAt)
  if (await loadClaimRow(
    env,
    reviewed.authorization.dispatchAttemptId,
    reviewed.authorization.authorizationId,
    reviewed.authorization.candidateHash,
    claimHash,
  )) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo dispatch attempt is already durably claimed and cannot be retried',
    )
  }
  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_dispatch_claims (
        dispatch_attempt_id, authorization_id, exchange_account_id,
        candidate_hash, authorization_hash, claim_hash, one_shot,
        demo_dispatch_reviewed, requires_account_coordinator_serialization,
        live_execution_allowed, real_funds_allowed, mainnet_allowed,
        withdrawals_allowed, automatically_retried, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, 0, 0, 0, 0, 0, ?)
    `).bind(
      reviewed.authorization.dispatchAttemptId,
      reviewed.authorization.authorizationId,
      reviewed.authorization.exchangeAccountId,
      reviewed.authorization.candidateHash,
      reviewed.authorizationHash,
      claimHash,
      normalizedClaimedAt,
    ).run()
  } catch {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo one-shot claim was rejected',
    )
  }
  const stored = await loadClaimRow(
    env,
    reviewed.authorization.dispatchAttemptId,
    reviewed.authorization.authorizationId,
    reviewed.authorization.candidateHash,
    claimHash,
  )
  if (!stored) throw new Error('Bitget demo dispatch claim is missing after immutable insert')
  const claim = claimFromRow(stored)
  assertClaimMatches(claim, reviewed, claimHash, normalizedClaimedAt)
  return claim
}

function normalizedProviderText(value: string | null, field: string): string | null {
  if (value === null) return null
  const normalized = value.trim()
  if (
    !normalized
    || normalized !== value
    || normalized.length > 256
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(`${field} is invalid`)
  }
  return normalized
}

function assertLookup(
  lookup: BitgetReadOnlyLookupInstruction,
  candidateLookup: BitgetReadOnlyLookupInstruction | undefined,
  index: number,
): void {
  const query = lookup.query
  const identityCount = Number(Boolean(query.orderId)) + Number(Boolean(query.clientOid))
  if (
    candidateLookup === undefined
    || lookup.method !== 'GET'
    || lookup.endpoint !== BITGET_MUTATION_EVIDENCE_ENDPOINTS.orderInfo
    || !PRODUCT_SYMBOL_PATTERN.test(query.symbol)
    || identityCount !== 1
    || canonicalJson(lookup) !== canonicalJson(candidateLookup)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      `Bitget demo recovery lookup ${index} does not match the reviewed candidate`,
    )
  }
}

function assertDispatchResult(
  reviewed: LoadedReviewedBitgetDemoAuthorization,
  candidate: BitgetUnsignedMutationCandidate,
  result: BitgetDemoDispatchResult,
): void {
  if (
    result.environment !== 'BITGET_DEMO'
    || result.dispatchAttemptId !== reviewed.authorization.dispatchAttemptId
    || result.authorizationId !== reviewed.authorization.authorizationId
    || result.exchangeAccountId !== reviewed.authorization.exchangeAccountId
    || result.candidateHash !== candidate.candidateHash
    || result.operation !== candidate.operation
    || result.endpoint !== candidate.endpoint
    || result.demoProviderMutationAttempted !== result.demoRequestSent
    || result.realProviderMutationAllowed !== false
    || result.liveExecutionAllowed !== false
    || result.realFundsAllowed !== false
    || result.mainnetAllowed !== false
    || result.withdrawalsAllowed !== false
    || result.automaticRetryAllowed !== false
    || result.recoveryLookups.length > 2
    || (result.recoveryLookups.length > 0) !== result.requiresReadOnlyRecovery
    || result.providerAcknowledgmentVerified !== (result.category === 'ACKNOWLEDGED')
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo dispatch result violates identity, recovery, or capability locks',
    )
  }
  if (!/^[a-z0-9_:-]{1,128}$/.test(result.reason)) {
    throw new BitgetDemoDispatchEvidenceConflictError('Bitget demo result reason is invalid')
  }
  if (result.requestBodyHash !== null) requiredHash(result.requestBodyHash, 'requestBodyHash')
  if (result.rateLimitReceiptHash !== null) {
    requiredHash(result.rateLimitReceiptHash, 'rateLimitReceiptHash')
  }
  if (
    result.httpStatus !== null
    && (!Number.isInteger(result.httpStatus) || result.httpStatus < 100 || result.httpStatus > 599)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError('Bitget demo HTTP status is invalid')
  }
  normalizedProviderText(result.providerCode, 'providerCode')
  normalizedProviderText(result.providerMessage, 'providerMessage')
  if (result.acknowledgedOrderId !== null) {
    if (requiredIdentifier(result.acknowledgedOrderId, 'acknowledgedOrderId') !== result.acknowledgedOrderId) {
      throw new BitgetDemoDispatchEvidenceConflictError('acknowledgedOrderId is not canonical')
    }
  }
  if (result.acknowledgedClientOrderId !== null) {
    if (
      requiredIdentifier(result.acknowledgedClientOrderId, 'acknowledgedClientOrderId')
      !== result.acknowledgedClientOrderId
    ) {
      throw new BitgetDemoDispatchEvidenceConflictError('acknowledgedClientOrderId is not canonical')
    }
  }
  if (!result.demoRequestSent) {
    if (
      result.httpStatus !== null
      || result.providerCode !== null
      || result.providerMessage !== null
      || result.acknowledgedOrderId !== null
      || result.acknowledgedClientOrderId !== null
    ) {
      throw new BitgetDemoDispatchEvidenceConflictError(
        'pre-send Bitget demo result cannot contain provider-response evidence',
      )
    }
  } else if (result.requestBodyHash === null || result.rateLimitReceiptHash === null) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'sent Bitget demo result must contain request and rate-limit evidence hashes',
    )
  }
  if (
    result.category === 'CANCEL_REPLACE_REQUIRES_LOOKUP'
    && (candidate.operation !== 'CANCEL_REPLACE' || result.recoveryLookups.length !== 2)
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'cancel-replace result must preserve both read-only recovery lookups',
    )
  }
  for (let index = 0; index < result.recoveryLookups.length; index += 1) {
    assertLookup(result.recoveryLookups[index]!, candidate.recoveryLookups[index], index)
  }
}

async function expectedLookupHash(
  dispatchAttemptId: string,
  lookup: BitgetReadOnlyLookupInstruction,
  index: number,
): Promise<string> {
  return canonicalHash({
    dispatchAttemptId,
    lookupIndex: index,
    lookup,
    providerMutationAllowed: false,
    liveExecutionAllowed: false,
    automaticallyDispatched: false,
  })
}

async function loadResultRow(
  env: BitgetDemoDispatchEvidenceEnv,
  dispatchAttemptId: string,
  authorizationId: string,
  candidateHash: string,
  resultHash: string,
): Promise<ResultRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_attempt_id, authorization_id, exchange_account_id,
           candidate_hash, operation, endpoint, category, reason,
           request_body_hash, rate_limit_receipt_hash, http_status,
           provider_code, provider_message, acknowledged_order_id,
           acknowledged_client_order_id, recovery_lookup_count, result_json,
           result_hash, environment, demo_request_sent,
           demo_provider_mutation_attempted, requires_read_only_recovery,
           provider_acknowledgment_verified, real_provider_mutation_allowed,
           live_execution_allowed, real_funds_allowed, mainnet_allowed,
           withdrawals_allowed, automatically_retried, occurred_at
      FROM live_bitget_demo_dispatch_results
     WHERE dispatch_attempt_id = ? OR authorization_id = ?
        OR candidate_hash = ? OR result_hash = ?
     LIMIT 1
  `).bind(
    dispatchAttemptId,
    authorizationId,
    candidateHash,
    resultHash,
  ).first<ResultRow>()
}

async function loadLookupRows(
  env: BitgetDemoDispatchEvidenceEnv,
  dispatchAttemptId: string,
): Promise<readonly LookupRow[]> {
  const rows = await env.DB.prepare(`
    SELECT lookup_index, method, endpoint, product_symbol, order_id,
           client_order_id, lookup_hash, provider_mutation_allowed,
           live_execution_allowed, automatically_dispatched
      FROM live_bitget_demo_dispatch_recovery_requirements
     WHERE dispatch_attempt_id = ?
     ORDER BY lookup_index ASC
  `).bind(dispatchAttemptId).all<LookupRow>()
  return Object.freeze(rows.results)
}

async function assertStoredResult(
  row: ResultRow,
  lookupRows: readonly LookupRow[],
  result: BitgetDemoDispatchResult,
  resultJson: string,
  resultHash: string,
  occurredAt: string,
): Promise<void> {
  assertResultRowCapabilities(row)
  if (
    row.dispatch_attempt_id !== result.dispatchAttemptId
    || row.authorization_id !== result.authorizationId
    || row.exchange_account_id !== result.exchangeAccountId
    || row.candidate_hash !== result.candidateHash
    || row.operation !== result.operation
    || row.endpoint !== result.endpoint
    || row.category !== result.category
    || row.reason !== result.reason
    || row.request_body_hash !== result.requestBodyHash
    || row.rate_limit_receipt_hash !== result.rateLimitReceiptHash
    || row.http_status !== result.httpStatus
    || row.provider_code !== result.providerCode
    || row.provider_message !== result.providerMessage
    || row.acknowledged_order_id !== result.acknowledgedOrderId
    || row.acknowledged_client_order_id !== result.acknowledgedClientOrderId
    || row.recovery_lookup_count !== result.recoveryLookups.length
    || row.result_json !== resultJson
    || row.result_hash !== resultHash
    || row.demo_request_sent !== Number(result.demoRequestSent)
    || row.demo_provider_mutation_attempted !== Number(result.demoProviderMutationAttempted)
    || row.requires_read_only_recovery !== Number(result.requiresReadOnlyRecovery)
    || row.provider_acknowledgment_verified !== Number(result.providerAcknowledgmentVerified)
    || row.occurred_at !== occurredAt
    || lookupRows.length !== result.recoveryLookups.length
  ) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'stored Bitget demo result conflicts with immutable result evidence',
    )
  }
  for (let index = 0; index < lookupRows.length; index += 1) {
    const stored = lookupRows[index]!
    const lookup = result.recoveryLookups[index]!
    const identity = lookup.query.orderId ?? lookup.query.clientOid ?? null
    if (
      stored.lookup_index !== index
      || stored.method !== lookup.method
      || stored.endpoint !== lookup.endpoint
      || stored.product_symbol !== lookup.query.symbol
      || stored.order_id !== (lookup.query.orderId ?? null)
      || stored.client_order_id !== (lookup.query.clientOid ?? null)
      || identity === null
      || stored.lookup_hash !== await expectedLookupHash(result.dispatchAttemptId, lookup, index)
      || stored.provider_mutation_allowed !== 0
      || stored.live_execution_allowed !== 0
      || stored.automatically_dispatched !== 0
    ) {
      throw new BitgetDemoDispatchEvidenceConflictError(
        `stored Bitget demo recovery requirement ${index} conflicts with result evidence`,
      )
    }
  }
}

function resultProjection(
  projectionStatus: BitgetDemoDispatchResultProjectionReceipt['projectionStatus'],
  result: BitgetDemoDispatchResult,
  resultHash: string,
): BitgetDemoDispatchResultProjectionReceipt {
  return Object.freeze({
    projectionStatus,
    dispatchAttemptId: result.dispatchAttemptId,
    authorizationId: result.authorizationId,
    candidateHash: result.candidateHash,
    resultHash,
    category: result.category,
    recoveryLookupCount: result.recoveryLookups.length,
    demoRequestSent: result.demoRequestSent,
    requiresReadOnlyRecovery: result.requiresReadOnlyRecovery,
    realProviderMutationAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticallyRetried: false,
  })
}

export async function persistBitgetDemoDispatchResult(
  env: BitgetDemoDispatchEvidenceEnv,
  reviewed: LoadedReviewedBitgetDemoAuthorization,
  claim: BitgetDemoDispatchClaim,
  candidate: BitgetUnsignedMutationCandidate,
  result: BitgetDemoDispatchResult,
  occurredAt: string,
): Promise<BitgetDemoDispatchResultProjectionReceipt> {
  assertBitgetDemoDispatchAuthorizationVerified(reviewed.authorization)
  await assertBitgetDemoCandidateIntegrity(candidate)
  const normalizedOccurredAt = requiredIso(occurredAt, 'occurredAt')
  if (Date.parse(normalizedOccurredAt) < Date.parse(claim.claimedAt)) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo result time cannot precede its immutable one-shot claim',
    )
  }
  const expectedStoredClaim = await loadClaimRow(
    env,
    claim.dispatchAttemptId,
    claim.authorizationId,
    claim.candidateHash,
    claim.claimHash,
  )
  if (!expectedStoredClaim) {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'immutable Bitget demo one-shot claim is missing',
    )
  }
  assertClaimMatches(
    claimFromRow(expectedStoredClaim),
    reviewed,
    await expectedClaimHash(reviewed, claim.claimedAt),
    claim.claimedAt,
  )
  assertDispatchResult(reviewed, candidate, result)
  const resultJson = canonicalJson(result)
  const resultHash = await canonicalHash(result)
  const existing = await loadResultRow(
    env,
    result.dispatchAttemptId,
    result.authorizationId,
    result.candidateHash,
    resultHash,
  )
  if (existing) {
    const lookupRows = await loadLookupRows(env, existing.dispatch_attempt_id)
    await assertStoredResult(
      existing,
      lookupRows,
      result,
      resultJson,
      resultHash,
      normalizedOccurredAt,
    )
    return resultProjection('REPLAYED', result, resultHash)
  }

  const lookupHashes = await Promise.all(result.recoveryLookups.map((lookup, index) => (
    expectedLookupHash(result.dispatchAttemptId, lookup, index)
  )))
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO live_bitget_demo_dispatch_results (
        dispatch_attempt_id, authorization_id, exchange_account_id,
        candidate_hash, operation, endpoint, category, reason,
        request_body_hash, rate_limit_receipt_hash, http_status,
        provider_code, provider_message, acknowledged_order_id,
        acknowledged_client_order_id, recovery_lookup_count, result_json,
        result_hash, environment, demo_request_sent,
        demo_provider_mutation_attempted, requires_read_only_recovery,
        provider_acknowledgment_verified, real_provider_mutation_allowed,
        live_execution_allowed, real_funds_allowed, mainnet_allowed,
        withdrawals_allowed, automatically_retried, occurred_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'BITGET_DEMO', ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?
      )
    `).bind(
      result.dispatchAttemptId,
      result.authorizationId,
      result.exchangeAccountId,
      result.candidateHash,
      result.operation,
      result.endpoint,
      result.category,
      result.reason,
      result.requestBodyHash,
      result.rateLimitReceiptHash,
      result.httpStatus,
      result.providerCode,
      result.providerMessage,
      result.acknowledgedOrderId,
      result.acknowledgedClientOrderId,
      result.recoveryLookups.length,
      resultJson,
      resultHash,
      Number(result.demoRequestSent),
      Number(result.demoProviderMutationAttempted),
      Number(result.requiresReadOnlyRecovery),
      Number(result.providerAcknowledgmentVerified),
      normalizedOccurredAt,
    ),
    ...result.recoveryLookups.map((lookup, index) => env.DB.prepare(`
      INSERT INTO live_bitget_demo_dispatch_recovery_requirements (
        dispatch_attempt_id, lookup_index, method, endpoint, product_symbol,
        order_id, client_order_id, lookup_hash, provider_mutation_allowed,
        live_execution_allowed, automatically_dispatched
      ) VALUES (?, ?, 'GET', ?, ?, ?, ?, ?, 0, 0, 0)
    `).bind(
      result.dispatchAttemptId,
      index,
      lookup.endpoint,
      lookup.query.symbol,
      lookup.query.orderId ?? null,
      lookup.query.clientOid ?? null,
      lookupHashes[index],
    )),
  ]
  try {
    await env.DB.batch(statements)
  } catch {
    throw new BitgetDemoDispatchEvidenceConflictError(
      'Bitget demo result evidence batch was rejected',
    )
  }
  const stored = await loadResultRow(
    env,
    result.dispatchAttemptId,
    result.authorizationId,
    result.candidateHash,
    resultHash,
  )
  if (!stored) throw new Error('Bitget demo result is missing after immutable D1 batch')
  const storedLookups = await loadLookupRows(env, result.dispatchAttemptId)
  await assertStoredResult(
    stored,
    storedLookups,
    result,
    resultJson,
    resultHash,
    normalizedOccurredAt,
  )
  return resultProjection('PROJECTED', result, resultHash)
}
