import { canonicalHash, canonicalJson, sha256Hex } from '../../canonical-json.ts'
import {
  bitgetDemoControlEvidenceBindingHash,
  type BitgetDemoFreshControlEvidenceInput,
} from './demo-certification-runner.ts'
import {
  loadReviewedBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchEvidenceEnv,
} from './demo-dispatch-evidence-store.ts'
import type { BitgetDemoFreshControlSource } from './demo-runtime-adapters.ts'
import type { BitgetUnsignedMutationCandidate } from './execution-candidate.ts'
import {
  assertBitgetDemoCandidateIntegrity,
  assertBitgetDemoDispatchAuthorizationVerified,
  type VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'

const IDENTIFIER = /^[A-Za-z0-9:._-]{1,128}$/
const HASH = /^[a-f0-9]{64}$/
const MAX_RISK_AGE_MS = 2_000
const ALLOWED_SCOPE_TYPES = new Set([
  'GLOBAL', 'ENVIRONMENT', 'EXCHANGE', 'ACCOUNT', 'STRATEGY', 'SYMBOL', 'ORDER_TYPE',
])

type ReloadInput = Parameters<BitgetDemoFreshControlSource['reload']>[0]
type ScopeType = 'GLOBAL' | 'ENVIRONMENT' | 'EXCHANGE' | 'ACCOUNT' | 'STRATEGY' | 'SYMBOL' | 'ORDER_TYPE'

export interface BitgetDemoGuardianScope {
  scopeType: ScopeType
  scopeKey: string
}

interface PermanentLocks {
  sourceOnly: true
  providerMutationAllowed: false
  executionAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
  accountingAutomaticallyDispatched: false
}

export interface RecordBitgetDemoPlaceControlBindingInput {
  bindingId: string
  assessmentId: string
  idempotencyOperationId: string
  guardianScopes: readonly BitgetDemoGuardianScope[]
  boundAt: string
}

export interface BitgetDemoPlaceControlBindingReceipt extends PermanentLocks {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  bindingId: string
  authorizationId: string
  dispatchAttemptId: string
  candidateHash: string
  assessmentId: string
  controlBindingHash: string
  environment: 'BITGET_DEMO'
}

type AssessmentRow = Record<string, unknown> & {
  assessment_id: string
  exchange_account_id: string
  provider: string
  idempotency_key: string
  preview_hash: string
  evidence_hash: string
  status: string
  operational_checks_passed: number
  execution_allowed: number
  risk_decision_json: string | null
  committed_at: string
}

type IdempotencyRow = Record<string, unknown> & {
  operation_scope: string
  idempotency_key: string
  request_hash: string
  operation_id: string
  exchange_account_id: string
  status: string
  response_json: string | null
  error_code: string | null
  expires_at: string | null
}

type GuardianRow = Record<string, unknown> & {
  scope_type: string
  scope_key: string
  status: string
  version: number
  updated_at: string
}

type BindingRow = Record<string, unknown> & {
  binding_id: string
  authorization_id: string
  dispatch_attempt_id: string
  exchange_account_id: string
  candidate_hash: string
  operation: string
  product_symbol: string
  assessment_id: string
  assessment_evidence_hash: string
  preview_hash: string
  risk_decision_id: string
  risk_configuration_version: string
  risk_decision_hash: string
  guardian_scopes_json: string
  guardian_scope_count: number
  guardian_scope_set_hash: string
  guardian_reviewed_state_hash: string
  idempotency_operation_id: string
  idempotency_operation_scope: string
  idempotency_key_hash: string
  control_binding_hash: string
  environment: string
  source_only: number
  provider_mutation_allowed: number
  execution_allowed: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatic_retry_allowed: number
  accounting_automatically_dispatched: number
  bound_at: string
}

interface ParsedRiskDecision {
  decisionId: string
  configurationVersion: string
  decidedAt: string
  raw: Readonly<Record<string, unknown>>
  hash: string
}

interface PreparedSources {
  assessment: AssessmentRow
  risk: ParsedRiskDecision
  scopes: readonly BitgetDemoGuardianScope[]
  scopesJson: string
  scopeSetHash: string
  guardianStateHash: string
  idempotency: IdempotencyRow
  idempotencyKeyHash: string
  evidence: BitgetDemoFreshControlEvidenceInput
}

interface BindingBase extends PermanentLocks {
  bindingId: string
  authorizationId: string
  dispatchAttemptId: string
  exchangeAccountId: string
  candidateHash: string
  operation: 'PLACE'
  productSymbol: string
  assessmentId: string
  assessmentEvidenceHash: string
  previewHash: string
  riskDecisionId: string
  riskConfigurationVersion: string
  riskDecisionHash: string
  guardianScopes: readonly BitgetDemoGuardianScope[]
  guardianScopeSetHash: string
  guardianReviewedStateHash: string
  idempotencyOperationId: string
  idempotencyOperationScope: string
  idempotencyKeyHash: string
  environment: 'BITGET_DEMO'
  boundAt: string
}

export class BitgetDemoControlBindingConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BitgetDemoControlBindingConflictError'
  }
}

function identifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER.test(normalized)) throw new BitgetDemoControlBindingConflictError(`${field} is invalid`)
  return normalized
}

function digest(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!HASH.test(normalized)) throw new BitgetDemoControlBindingConflictError(`${field} must be a SHA-256 digest`)
  return normalized
}

function iso(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  const parsed = Date.parse(normalized)
  if (!normalized || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new BitgetDemoControlBindingConflictError(`${field} must be canonical ISO-8601`)
  }
  return normalized
}

function symbol(candidate: BitgetUnsignedMutationCandidate): string {
  return identifier(candidate.unsignedBody.symbol ?? '', 'candidate product symbol')
}

function orderType(candidate: BitgetUnsignedMutationCandidate): string {
  return identifier(String(candidate.unsignedBody.orderType ?? '').toUpperCase(), 'candidate order type')
}

function normalizeScopes(
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  input: readonly BitgetDemoGuardianScope[],
): readonly BitgetDemoGuardianScope[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw new BitgetDemoControlBindingConflictError('Guardian scope set must contain one through eight scopes')
  }
  const scopes = input.map((value) => {
    const scopeType = String(value.scopeType ?? '').trim().toUpperCase()
    if (!ALLOWED_SCOPE_TYPES.has(scopeType)) {
      throw new BitgetDemoControlBindingConflictError('Guardian scope type is unsupported')
    }
    return Object.freeze({
      scopeType: scopeType as ScopeType,
      scopeKey: identifier(value.scopeKey, 'Guardian scope key'),
    })
  }).sort((a, b) => a.scopeType.localeCompare(b.scopeType) || a.scopeKey.localeCompare(b.scopeKey))

  const identities = scopes.map((scope) => `${scope.scopeType}:${scope.scopeKey}`)
  if (new Set(identities).size !== identities.length) {
    throw new BitgetDemoControlBindingConflictError('Guardian scope set contains duplicates')
  }
  for (const mandatory of [
    'GLOBAL:global',
    'ENVIRONMENT:BITGET_DEMO',
    'EXCHANGE:BITGET',
    `ACCOUNT:${authorization.exchangeAccountId}`,
    `SYMBOL:${symbol(candidate)}`,
    `ORDER_TYPE:${orderType(candidate)}`,
  ]) {
    if (!identities.includes(mandatory)) {
      throw new BitgetDemoControlBindingConflictError(`Guardian scope set is missing ${mandatory}`)
    }
  }
  return Object.freeze(scopes)
}

async function assessment(env: BitgetDemoDispatchEvidenceEnv, assessmentId: string): Promise<AssessmentRow> {
  const row = await env.DB.prepare(`
    SELECT assessment_id, exchange_account_id, provider, idempotency_key,
           preview_hash, evidence_hash, status, operational_checks_passed,
           execution_allowed, risk_decision_json, committed_at
      FROM live_candidate_assessments WHERE assessment_id = ? LIMIT 1
  `).bind(assessmentId).first<AssessmentRow>()
  if (!row) throw new BitgetDemoControlBindingConflictError('locked candidate assessment is missing')
  return row
}

async function idempotency(env: BitgetDemoDispatchEvidenceEnv, operationId: string): Promise<IdempotencyRow> {
  const row = await env.DB.prepare(`
    SELECT operation_scope, idempotency_key, request_hash, operation_id,
           exchange_account_id, status, response_json, error_code, expires_at
      FROM idempotency_records WHERE operation_id = ? LIMIT 1
  `).bind(operationId).first<IdempotencyRow>()
  if (!row) throw new BitgetDemoControlBindingConflictError('durable idempotency record is missing')
  return row
}

function parseRisk(row: AssessmentRow): Promise<ParsedRiskDecision> {
  if (row.risk_decision_json === null) {
    throw new BitgetDemoControlBindingConflictError('locked assessment has no risk decision')
  }
  let value: unknown
  try {
    value = JSON.parse(row.risk_decision_json) as unknown
  } catch {
    throw new BitgetDemoControlBindingConflictError('locked assessment risk decision is malformed')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BitgetDemoControlBindingConflictError('locked assessment risk decision is invalid')
  }
  const raw = value as Record<string, unknown>
  if (raw.approved !== true || !Array.isArray(raw.rules)) {
    throw new BitgetDemoControlBindingConflictError('locked assessment risk decision is not approved')
  }
  const decisionId = identifier(String(raw.decisionId ?? ''), 'risk decision ID')
  const configurationVersion = identifier(String(raw.configurationVersion ?? ''), 'risk configuration version')
  const decidedAt = iso(String(raw.decidedAt ?? ''), 'risk decidedAt')
  const frozen = Object.freeze({ ...raw })
  return canonicalHash(frozen).then((hash) => ({ decisionId, configurationVersion, decidedAt, raw: frozen, hash }))
}

async function guardianHash(
  env: BitgetDemoDispatchEvidenceEnv,
  scopes: readonly BitgetDemoGuardianScope[],
): Promise<string> {
  const snapshot = await Promise.all(scopes.map(async (scope) => {
    const row = await env.DB.prepare(`
      SELECT scope_type, scope_key, status, version, updated_at
        FROM live_guardian_states
       WHERE scope_type = ? AND scope_key = ? LIMIT 1
    `).bind(scope.scopeType, scope.scopeKey).first<GuardianRow>()
    if (
      !row
      || row.scope_type !== scope.scopeType
      || row.scope_key !== scope.scopeKey
      || row.status !== 'CLEAR'
      || !Number.isSafeInteger(row.version)
      || row.version < 1
      || !String(row.updated_at ?? '').trim()
    ) {
      throw new BitgetDemoControlBindingConflictError(
        `Guardian state is not clear for ${scope.scopeType}:${scope.scopeKey}`,
      )
    }
    return Object.freeze({
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      status: 'CLEAR' as const,
      version: row.version,
      updatedAt: row.updated_at,
    })
  }))
  return canonicalHash(snapshot)
}

function assertAssessment(
  row: AssessmentRow,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
): void {
  if (
    candidate.operation !== 'PLACE'
    || candidate.evidenceBindings.previewHash === null
    || row.provider !== 'BITGET'
    || row.exchange_account_id !== authorization.exchangeAccountId
    || row.status !== 'READY_BUT_EXECUTION_LOCKED'
    || row.operational_checks_passed !== 1
    || row.execution_allowed !== 0
    || row.preview_hash !== candidate.evidenceBindings.previewHash
  ) {
    throw new BitgetDemoControlBindingConflictError('place candidate does not match a ready, execution-locked assessment')
  }
  digest(row.evidence_hash, 'assessment evidence hash')
  digest(row.preview_hash, 'assessment preview hash')
  iso(row.committed_at, 'assessment committedAt')
}

function assertIdempotency(
  row: IdempotencyRow,
  lockedAssessment: AssessmentRow,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  evaluatedAt: string,
): void {
  if (
    row.exchange_account_id !== authorization.exchangeAccountId
    || row.idempotency_key !== lockedAssessment.idempotency_key
    || row.status !== 'CLAIMED'
    || row.response_json !== null
    || row.error_code !== null
  ) {
    throw new BitgetDemoControlBindingConflictError('durable idempotency record is not an active claim')
  }
  identifier(row.operation_scope, 'idempotency operation scope')
  identifier(row.operation_id, 'idempotency operation ID')
  digest(row.request_hash, 'idempotency request hash')
  if (row.expires_at !== null && Date.parse(iso(row.expires_at, 'idempotency expiresAt')) <= Date.parse(evaluatedAt)) {
    throw new BitgetDemoControlBindingConflictError('durable idempotency claim is expired')
  }
}

function common(
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  reloadedAt: string,
) {
  return {
    schemaVersion: 1 as const,
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: authorization.exchangeAccountId,
    candidateHash: candidate.candidateHash,
    operation: 'PLACE' as const,
    productSymbol: symbol(candidate),
    reloadedAt,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  }
}

async function prepare(
  env: BitgetDemoDispatchEvidenceEnv,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  assessmentId: string,
  operationId: string,
  scopeInput: readonly BitgetDemoGuardianScope[],
  evaluatedAt: string,
): Promise<PreparedSources> {
  const lockedAssessment = await assessment(env, assessmentId)
  assertAssessment(lockedAssessment, candidate, authorization)
  const risk = await parseRisk(lockedAssessment)
  const durableClaim = await idempotency(env, operationId)
  assertIdempotency(durableClaim, lockedAssessment, authorization, evaluatedAt)
  const scopes = normalizeScopes(candidate, authorization, scopeInput)
  const scopesJson = canonicalJson(scopes)
  const scopeSetHash = await canonicalHash(scopes)
  const guardianStateHash = await guardianHash(env, scopes)
  const idempotencyKeyHash = await sha256Hex(durableClaim.idempotency_key)
  const base = common(candidate, authorization, evaluatedAt)
  const evidence: BitgetDemoFreshControlEvidenceInput = Object.freeze({
    guardian: Object.freeze({
      ...base,
      evidenceType: 'GUARDIAN',
      status: 'CLEAR',
      actionAllowed: true,
      stateVersionHash: guardianStateHash,
    }),
    risk: Object.freeze({
      ...base,
      evidenceType: 'RISK',
      decisionId: risk.decisionId,
      configurationVersion: risk.configurationVersion,
      approved: true,
    }),
    idempotency: Object.freeze({
      ...base,
      evidenceType: 'IDEMPOTENCY',
      authorizationId: authorization.authorizationId,
      dispatchAttemptId: authorization.dispatchAttemptId,
      claimId: durableClaim.operation_id,
      idempotencyKeyHash,
      status: 'CLAIMED',
    }),
  })
  const [guardianEvidenceHash, riskEvidenceHash, idempotencyEvidenceHash] = await Promise.all([
    bitgetDemoControlEvidenceBindingHash(evidence.guardian),
    bitgetDemoControlEvidenceBindingHash(evidence.risk),
    bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
  ])
  if (
    guardianEvidenceHash !== authorization.guardianEvidenceHash
    || riskEvidenceHash !== authorization.riskEvidenceHash
    || idempotencyEvidenceHash !== authorization.idempotencyEvidenceHash
  ) {
    throw new BitgetDemoControlBindingConflictError('current controls do not match the reviewed authorization evidence')
  }
  return {
    assessment: lockedAssessment,
    risk,
    scopes,
    scopesJson,
    scopeSetHash,
    guardianStateHash,
    idempotency: durableClaim,
    idempotencyKeyHash,
    evidence,
  }
}

function bindingBase(input: {
  bindingId: string
  authorization: VerifiedBitgetDemoDispatchAuthorization
  candidate: BitgetUnsignedMutationCandidate
  sources: PreparedSources
  boundAt: string
}): BindingBase {
  return Object.freeze({
    bindingId: input.bindingId,
    authorizationId: input.authorization.authorizationId,
    dispatchAttemptId: input.authorization.dispatchAttemptId,
    exchangeAccountId: input.authorization.exchangeAccountId,
    candidateHash: input.candidate.candidateHash,
    operation: 'PLACE',
    productSymbol: symbol(input.candidate),
    assessmentId: input.sources.assessment.assessment_id,
    assessmentEvidenceHash: input.sources.assessment.evidence_hash,
    previewHash: input.sources.assessment.preview_hash,
    riskDecisionId: input.sources.risk.decisionId,
    riskConfigurationVersion: input.sources.risk.configurationVersion,
    riskDecisionHash: input.sources.risk.hash,
    guardianScopes: input.sources.scopes,
    guardianScopeSetHash: input.sources.scopeSetHash,
    guardianReviewedStateHash: input.sources.guardianStateHash,
    idempotencyOperationId: input.sources.idempotency.operation_id,
    idempotencyOperationScope: input.sources.idempotency.operation_scope,
    idempotencyKeyHash: input.sources.idempotencyKeyHash,
    environment: 'BITGET_DEMO',
    sourceOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
    accountingAutomaticallyDispatched: false,
    boundAt: input.boundAt,
  })
}

function rowBase(row: BindingRow): BindingBase {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.guardian_scopes_json) as unknown
  } catch {
    throw new BitgetDemoControlBindingConflictError('stored Guardian scopes are malformed')
  }
  if (!Array.isArray(parsed)) throw new BitgetDemoControlBindingConflictError('stored Guardian scopes are invalid')
  const guardianScopes = Object.freeze(parsed.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BitgetDemoControlBindingConflictError('stored Guardian scope entry is invalid')
    }
    const item = value as Record<string, unknown>
    return Object.freeze({
      scopeType: String(item.scopeType ?? '') as ScopeType,
      scopeKey: String(item.scopeKey ?? ''),
    })
  }))
  return Object.freeze({
    bindingId: row.binding_id,
    authorizationId: row.authorization_id,
    dispatchAttemptId: row.dispatch_attempt_id,
    exchangeAccountId: row.exchange_account_id,
    candidateHash: row.candidate_hash,
    operation: 'PLACE',
    productSymbol: row.product_symbol,
    assessmentId: row.assessment_id,
    assessmentEvidenceHash: row.assessment_evidence_hash,
    previewHash: row.preview_hash,
    riskDecisionId: row.risk_decision_id,
    riskConfigurationVersion: row.risk_configuration_version,
    riskDecisionHash: row.risk_decision_hash,
    guardianScopes,
    guardianScopeSetHash: row.guardian_scope_set_hash,
    guardianReviewedStateHash: row.guardian_reviewed_state_hash,
    idempotencyOperationId: row.idempotency_operation_id,
    idempotencyOperationScope: row.idempotency_operation_scope,
    idempotencyKeyHash: row.idempotency_key_hash,
    environment: 'BITGET_DEMO',
    sourceOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
    accountingAutomaticallyDispatched: false,
    boundAt: row.bound_at,
  })
}

function assertRowLocks(row: BindingRow): void {
  if (
    row.environment !== 'BITGET_DEMO'
    || row.operation !== 'PLACE'
    || row.source_only !== 1
    || row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.accounting_automatically_dispatched !== 0
  ) {
    throw new BitgetDemoControlBindingConflictError('stored control-binding capability locks are invalid')
  }
}

async function assertStored(row: BindingRow, expected?: BindingBase): Promise<void> {
  assertRowLocks(row)
  const actual = rowBase(row)
  if (await canonicalHash(actual) !== digest(row.control_binding_hash, 'control binding hash')) {
    throw new BitgetDemoControlBindingConflictError('stored control binding hash is invalid')
  }
  if (expected && canonicalJson(actual) !== canonicalJson(expected)) {
    throw new BitgetDemoControlBindingConflictError('stored control binding conflicts with reviewed sources')
  }
}

async function findBinding(
  env: BitgetDemoDispatchEvidenceEnv,
  identity: Readonly<{
    bindingId: string
    authorizationId: string
    dispatchAttemptId: string
    candidateHash: string
    controlBindingHash?: string
  }>,
): Promise<BindingRow | null> {
  return env.DB.prepare(`
    SELECT binding_id, authorization_id, dispatch_attempt_id, exchange_account_id,
           candidate_hash, operation, product_symbol, assessment_id,
           assessment_evidence_hash, preview_hash, risk_decision_id,
           risk_configuration_version, risk_decision_hash, guardian_scopes_json,
           guardian_scope_count, guardian_scope_set_hash, guardian_reviewed_state_hash,
           idempotency_operation_id, idempotency_operation_scope, idempotency_key_hash,
           control_binding_hash, environment, source_only, provider_mutation_allowed,
           execution_allowed, live_execution_allowed, real_funds_allowed,
           mainnet_allowed, withdrawals_allowed, automatic_retry_allowed,
           accounting_automatically_dispatched, bound_at
      FROM live_bitget_demo_place_control_bindings
     WHERE binding_id = ? OR authorization_id = ? OR dispatch_attempt_id = ?
        OR candidate_hash = ? OR control_binding_hash = ? LIMIT 1
  `).bind(
    identity.bindingId,
    identity.authorizationId,
    identity.dispatchAttemptId,
    identity.candidateHash,
    identity.controlBindingHash ?? '',
  ).first<BindingRow>()
}

function projection(
  projectionStatus: 'PROJECTED' | 'REPLAYED',
  base: BindingBase,
  controlBindingHash: string,
): BitgetDemoPlaceControlBindingReceipt {
  return Object.freeze({
    projectionStatus,
    bindingId: base.bindingId,
    authorizationId: base.authorizationId,
    dispatchAttemptId: base.dispatchAttemptId,
    candidateHash: base.candidateHash,
    assessmentId: base.assessmentId,
    controlBindingHash,
    environment: 'BITGET_DEMO',
    sourceOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
    accountingAutomaticallyDispatched: false,
  })
}

export async function recordBitgetDemoPlaceControlBinding(
  env: BitgetDemoDispatchEvidenceEnv,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  input: RecordBitgetDemoPlaceControlBindingInput,
): Promise<BitgetDemoPlaceControlBindingReceipt> {
  assertBitgetDemoDispatchAuthorizationVerified(authorization)
  await assertBitgetDemoCandidateIntegrity(candidate)
  const bindingId = identifier(input.bindingId, 'bindingId')
  const assessmentId = identifier(input.assessmentId, 'assessmentId')
  const operationId = identifier(input.idempotencyOperationId, 'idempotencyOperationId')
  const boundAt = iso(input.boundAt, 'boundAt')
  await loadReviewedBitgetDemoDispatchAuthorization(
    env,
    candidate,
    authorization.authorizationId,
    authorization.dispatchAttemptId,
    boundAt,
  )
  const sources = await prepare(env, candidate, authorization, assessmentId, operationId, input.guardianScopes, boundAt)
  const base = bindingBase({ bindingId, authorization, candidate, sources, boundAt })
  const controlBindingHash = await canonicalHash(base)
  const existing = await findBinding(env, {
    bindingId,
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    candidateHash: candidate.candidateHash,
    controlBindingHash,
  })
  if (existing) {
    await assertStored(existing, base)
    return projection('REPLAYED', base, controlBindingHash)
  }
  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_place_control_bindings (
        binding_id, authorization_id, dispatch_attempt_id, exchange_account_id,
        candidate_hash, operation, product_symbol, assessment_id,
        assessment_evidence_hash, preview_hash, risk_decision_id,
        risk_configuration_version, risk_decision_hash, guardian_scopes_json,
        guardian_scope_count, guardian_scope_set_hash, guardian_reviewed_state_hash,
        idempotency_operation_id, idempotency_operation_scope, idempotency_key_hash,
        control_binding_hash, environment, source_only, provider_mutation_allowed,
        execution_allowed, live_execution_allowed, real_funds_allowed, mainnet_allowed,
        withdrawals_allowed, automatic_retry_allowed,
        accounting_automatically_dispatched, bound_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'PLACE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'BITGET_DEMO', 1, 0, 0, 0, 0, 0, 0, 0, 0, ?
      )
    `).bind(
      base.bindingId, base.authorizationId, base.dispatchAttemptId,
      base.exchangeAccountId, base.candidateHash, base.productSymbol,
      base.assessmentId, base.assessmentEvidenceHash, base.previewHash,
      base.riskDecisionId, base.riskConfigurationVersion, base.riskDecisionHash,
      sources.scopesJson, base.guardianScopes.length, base.guardianScopeSetHash,
      base.guardianReviewedStateHash, base.idempotencyOperationId,
      base.idempotencyOperationScope, base.idempotencyKeyHash,
      controlBindingHash, base.boundAt,
    ).run()
  } catch {
    throw new BitgetDemoControlBindingConflictError('immutable control-binding insert was rejected')
  }
  const stored = await findBinding(env, {
    bindingId,
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    candidateHash: candidate.candidateHash,
    controlBindingHash,
  })
  if (!stored) throw new Error('control binding is missing after immutable insert')
  await assertStored(stored, base)
  return projection('PROJECTED', base, controlBindingHash)
}

export function createD1BitgetDemoFreshControlSource(
  env: BitgetDemoDispatchEvidenceEnv,
): BitgetDemoFreshControlSource {
  const source: BitgetDemoFreshControlSource = {
    async reload(input: ReloadInput): Promise<BitgetDemoFreshControlEvidenceInput> {
      assertBitgetDemoDispatchAuthorizationVerified(input.authorization)
      await assertBitgetDemoCandidateIntegrity(input.candidate)
      const evaluatedAt = iso(input.evaluatedAt, 'evaluatedAt')
      const row = await findBinding(env, {
        bindingId: '',
        authorizationId: input.authorization.authorizationId,
        dispatchAttemptId: input.authorization.dispatchAttemptId,
        candidateHash: input.candidate.candidateHash,
      })
      if (!row) throw new BitgetDemoControlBindingConflictError('immutable place control binding is missing')
      await assertStored(row)
      if (
        row.authorization_id !== input.authorization.authorizationId
        || row.dispatch_attempt_id !== input.authorization.dispatchAttemptId
        || row.exchange_account_id !== input.authorization.exchangeAccountId
        || row.candidate_hash !== input.candidate.candidateHash
        || row.operation !== input.candidate.operation
        || row.product_symbol !== symbol(input.candidate)
      ) {
        throw new BitgetDemoControlBindingConflictError('immutable place control-binding identity mismatch')
      }
      const reviewed = rowBase(row)
      const sources = await prepare(
        env,
        input.candidate,
        input.authorization,
        reviewed.assessmentId,
        reviewed.idempotencyOperationId,
        reviewed.guardianScopes,
        evaluatedAt,
      )
      const evaluatedAtMs = Date.parse(evaluatedAt)
      const decidedAtMs = Date.parse(sources.risk.decidedAt)
      if (decidedAtMs > evaluatedAtMs || evaluatedAtMs - decidedAtMs > MAX_RISK_AGE_MS) {
        throw new BitgetDemoControlBindingConflictError('risk decision is too old for demo certification')
      }
      if (
        sources.guardianStateHash !== reviewed.guardianReviewedStateHash
        || sources.risk.hash !== reviewed.riskDecisionHash
        || sources.idempotency.operation_scope !== reviewed.idempotencyOperationScope
        || sources.idempotencyKeyHash !== reviewed.idempotencyKeyHash
      ) {
        throw new BitgetDemoControlBindingConflictError('fresh control source changed after review')
      }
      return sources.evidence
    },
  }
  return Object.freeze(source)
}
