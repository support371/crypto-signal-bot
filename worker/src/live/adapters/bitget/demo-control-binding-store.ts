import { canonicalHash, canonicalJson, sha256Hex } from '../../canonical-json.ts'
import type { RiskDecision, RiskRuleResult } from '../../domain.ts'
import {
  bitgetDemoControlEvidenceBindingHash,
  type BitgetDemoFreshControlEvidenceInput,
} from './demo-certification-runner.ts'
import {
  loadReviewedBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchEvidenceEnv,
} from './demo-dispatch-evidence-store.ts'
import type { BitgetDemoFreshControlSource } from './demo-runtime-adapters.ts'
import {
  assertBitgetDemoCandidateIntegrity,
  type BitgetUnsignedMutationCandidate,
} from './execution-candidate.ts'
import {
  assertBitgetDemoDispatchAuthorizationVerified,
  type VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const MAX_FRESH_RISK_AGE_MS = 2_000
const ALLOWED_GUARDIAN_SCOPES = new Set([
  'GLOBAL',
  'ENVIRONMENT',
  'EXCHANGE',
  'ACCOUNT',
  'STRATEGY',
  'SYMBOL',
  'ORDER_TYPE',
])

type FreshReloadInput = Parameters<BitgetDemoFreshControlSource['reload']>[0]
type GuardianScopeType =
  | 'GLOBAL'
  | 'ENVIRONMENT'
  | 'EXCHANGE'
  | 'ACCOUNT'
  | 'STRATEGY'
  | 'SYMBOL'
  | 'ORDER_TYPE'

export interface BitgetDemoGuardianScope {
  scopeType: GuardianScopeType
  scopeKey: string
}

interface PermanentControlLocks {
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

export interface BitgetDemoPlaceControlBindingReceipt extends PermanentControlLocks {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  bindingId: string
  authorizationId: string
  dispatchAttemptId: string
  candidateHash: string
  assessmentId: string
  controlBindingHash: string
  environment: 'BITGET_DEMO'
}

type AssessmentRow = {
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
} & Record<string, unknown>

type IdempotencyRow = {
  operation_scope: string
  idempotency_key: string
  request_hash: string
  operation_id: string
  exchange_account_id: string
  status: string
  response_json: string | null
  error_code: string | null
  expires_at: string | null
} & Record<string, unknown>

type GuardianStateRow = {
  scope_type: string
  scope_key: string
  status: string
  version: number
  updated_at: string
} & Record<string, unknown>

type BindingRow = {
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
} & Record<string, unknown>

interface PreparedSources {
  assessment: AssessmentRow
  riskDecision: RiskDecision
  riskDecisionHash: string
  scopes: readonly BitgetDemoGuardianScope[]
  scopesJson: string
  scopeSetHash: string
  guardianStateHash: string
  idempotency: IdempotencyRow
  idempotencyKeyHash: string
  evidence: BitgetDemoFreshControlEvidenceInput
}

interface BindingHashBase extends PermanentControlLocks {
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

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoControlBindingConflictError(`${field} is invalid`)
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!HASH_PATTERN.test(normalized)) {
    throw new BitgetDemoControlBindingConflictError(`${field} must be a SHA-256 digest`)
  }
  return normalized
}

function requiredIso(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  const milliseconds = Date.parse(normalized)
  if (!normalized || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new BitgetDemoControlBindingConflictError(`${field} must be canonical ISO-8601`)
  }
  return normalized
}

function productSymbol(candidate: BitgetUnsignedMutationCandidate): string {
  return requiredIdentifier(candidate.unsignedBody.symbol ?? '', 'candidate product symbol')
}

function orderTypeScope(candidate: BitgetUnsignedMutationCandidate): string {
  return requiredIdentifier(String(candidate.unsignedBody.orderType ?? '').toUpperCase(), 'candidate order type')
}

function normalizeScopes(
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  input: readonly BitgetDemoGuardianScope[],
): readonly BitgetDemoGuardianScope[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw new BitgetDemoControlBindingConflictError('Guardian scope set must contain one through eight scopes')
  }
  const scopes = input.map((scope) => {
    const scopeType = String(scope.scopeType ?? '').trim().toUpperCase()
    if (!ALLOWED_GUARDIAN_SCOPES.has(scopeType)) {
      throw new BitgetDemoControlBindingConflictError('Guardian scope type is unsupported')
    }
    return Object.freeze({
      scopeType: scopeType as GuardianScopeType,
      scopeKey: requiredIdentifier(scope.scopeKey, 'Guardian scope key'),
    })
  }).sort((left, right) => (
    left.scopeType.localeCompare(right.scopeType) || left.scopeKey.localeCompare(right.scopeKey)
  ))
  const keys = scopes.map((scope) => `${scope.scopeType}:${scope.scopeKey}`)
  if (new Set(keys).size !== keys.length) {
    throw new BitgetDemoControlBindingConflictError('Guardian scope set contains duplicates')
  }
  for (const required of [
    'GLOBAL:global',
    'ENVIRONMENT:BITGET_DEMO',
    'EXCHANGE:BITGET',
    `ACCOUNT:${authorization.exchangeAccountId}`,
    `SYMBOL:${productSymbol(candidate)}`,
    `ORDER_TYPE:${orderTypeScope(candidate)}`,
  ]) {
    if (!keys.includes(required)) {
      throw new BitgetDemoControlBindingConflictError(`Guardian scope set is missing ${required}`)
    }
  }
  return Object.freeze(scopes)
}

function parseRiskRule(value: unknown): RiskRuleResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BitgetDemoControlBindingConflictError('risk rule is invalid')
  }
  const row = value as Record<string, unknown>
  const rule = requiredIdentifier(String(row.rule ?? ''), 'risk rule')
  if (typeof row.passed !== 'boolean') {
    throw new BitgetDemoControlBindingConflictError('risk rule decision is invalid')
  }
  const reason = row.reason === null ? null : String(row.reason ?? '').trim()
  return Object.freeze({
    rule,
    passed: row.passed,
    reason: reason || null,
    observedValue: row.observedValue as RiskRuleResult['observedValue'],
    limitValue: row.limitValue as RiskRuleResult['limitValue'],
  })
}

function parseApprovedRiskDecision(row: AssessmentRow): RiskDecision {
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
  const source = value as Record<string, unknown>
  if (source.approved !== true || !Array.isArray(source.rules)) {
    throw new BitgetDemoControlBindingConflictError('locked assessment risk decision is not approved')
  }
  return Object.freeze({
    decisionId: requiredIdentifier(String(source.decisionId ?? ''), 'risk decision ID'),
    approved: true,
    rules: Object.freeze(source.rules.map(parseRiskRule)),
    configurationVersion: requiredIdentifier(
      String(source.configurationVersion ?? ''),
      'risk configuration version',
    ),
    decidedAt: requiredIso(String(source.decidedAt ?? ''), 'risk decidedAt'),
  })
}

async function loadAssessment(
  env: BitgetDemoDispatchEvidenceEnv,
  assessmentId: string,
): Promise<AssessmentRow> {
  const row = await env.DB.prepare(`
    SELECT assessment_id, exchange_account_id, provider, idempotency_key,
           preview_hash, evidence_hash, status, operational_checks_passed,
           execution_allowed, risk_decision_json, committed_at
      FROM live_candidate_assessments
     WHERE assessment_id = ?
     LIMIT 1
  `).bind(assessmentId).first<AssessmentRow>()
  if (!row) throw new BitgetDemoControlBindingConflictError('locked candidate assessment is missing')
  return row
}

async function loadIdempotency(
  env: BitgetDemoDispatchEvidenceEnv,
  operationId: string,
): Promise<IdempotencyRow> {
  const row = await env.DB.prepare(`
    SELECT operation_scope, idempotency_key, request_hash, operation_id,
           exchange_account_id, status, response_json, error_code, expires_at
      FROM idempotency_records
     WHERE operation_id = ?
     LIMIT 1
  `).bind(operationId).first<IdempotencyRow>()
  if (!row) throw new BitgetDemoControlBindingConflictError('durable idempotency record is missing')
  return row
}

async function loadGuardianStateHash(
  env: BitgetDemoDispatchEvidenceEnv,
  scopes: readonly BitgetDemoGuardianScope[],
): Promise<string> {
  const snapshot = await Promise.all(scopes.map(async (scope) => {
    const row = await env.DB.prepare(`
      SELECT scope_type, scope_key, status, version, updated_at
        FROM live_guardian_states
       WHERE scope_type = ? AND scope_key = ?
       LIMIT 1
    `).bind(scope.scopeType, scope.scopeKey).first<GuardianStateRow>()
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
  assessment: AssessmentRow,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
): void {
  if (
    candidate.operation !== 'PLACE'
    || candidate.evidenceBindings.previewHash === null
    || assessment.provider !== 'BITGET'
    || assessment.exchange_account_id !== authorization.exchangeAccountId
    || assessment.status !== 'READY_BUT_EXECUTION_LOCKED'
    || assessment.operational_checks_passed !== 1
    || assessment.execution_allowed !== 0
    || assessment.preview_hash !== candidate.evidenceBindings.previewHash
  ) {
    throw new BitgetDemoControlBindingConflictError(
      'place candidate does not match a ready, execution-locked assessment',
    )
  }
  requiredHash(assessment.evidence_hash, 'assessment evidence hash')
  requiredHash(assessment.preview_hash, 'assessment preview hash')
  requiredIso(assessment.committed_at, 'assessment committedAt')
}

function assertIdempotency(
  row: IdempotencyRow,
  assessment: AssessmentRow,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  evaluatedAt: string,
): void {
  if (
    row.exchange_account_id !== authorization.exchangeAccountId
    || row.idempotency_key !== assessment.idempotency_key
    || row.status !== 'CLAIMED'
    || row.response_json !== null
    || row.error_code !== null
  ) {
    throw new BitgetDemoControlBindingConflictError('durable idempotency record is not an active claim')
  }
  requiredIdentifier(row.operation_scope, 'idempotency operation scope')
  requiredIdentifier(row.operation_id, 'idempotency operation ID')
  requiredHash(row.request_hash, 'idempotency request hash')
  if (
    row.expires_at !== null
    && Date.parse(requiredIso(row.expires_at, 'idempotency expiresAt')) <= Date.parse(evaluatedAt)
  ) {
    throw new BitgetDemoControlBindingConflictError('durable idempotency claim is expired')
  }
}

function commonEvidence(
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
    productSymbol: productSymbol(candidate),
    reloadedAt,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  }
}

async function prepareSources(
  env: BitgetDemoDispatchEvidenceEnv,
  candidate: BitgetUnsignedMutationCandidate,
  authorization: VerifiedBitgetDemoDispatchAuthorization,
  assessmentId: string,
  idempotencyOperationId: string,
  guardianScopes: readonly BitgetDemoGuardianScope[],
  evaluatedAt: string,
): Promise<PreparedSources> {
  const assessment = await loadAssessment(env, assessmentId)
  assertAssessment(assessment, candidate, authorization)
  const riskDecision = parseApprovedRiskDecision(assessment)
  const riskDecisionHash = await canonicalHash(riskDecision)
  const idempotency = await loadIdempotency(env, idempotencyOperationId)
  assertIdempotency(idempotency, assessment, authorization, evaluatedAt)
  const scopes = normalizeScopes(candidate, authorization, guardianScopes)
  const scopesJson = canonicalJson(scopes)
  const scopeSetHash = await canonicalHash(scopes)
  const guardianStateHash = await loadGuardianStateHash(env, scopes)
  const idempotencyKeyHash = await sha256Hex(idempotency.idempotency_key)
  const common = commonEvidence(candidate, authorization, evaluatedAt)
  const evidence: BitgetDemoFreshControlEvidenceInput = Object.freeze({
    guardian: Object.freeze({
      ...common,
      evidenceType: 'GUARDIAN',
      status: 'CLEAR',
      actionAllowed: true,
      stateVersionHash: guardianStateHash,
    }),
    risk: Object.freeze({
      ...common,
      evidenceType: 'RISK',
      decisionId: riskDecision.decisionId,
      configurationVersion: riskDecision.configurationVersion,
      approved: true,
    }),
    idempotency: Object.freeze({
      ...common,
      evidenceType: 'IDEMPOTENCY',
      authorizationId: authorization.authorizationId,
      dispatchAttemptId: authorization.dispatchAttemptId,
      claimId: idempotency.operation_id,
      idempotencyKeyHash,
      status: 'CLAIMED',
    }),
  })
  const [guardianHash, riskHash, idempotencyHash] = await Promise.all([
    bitgetDemoControlEvidenceBindingHash(evidence.guardian),
    bitgetDemoControlEvidenceBindingHash(evidence.risk),
    bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
  ])
  if (
    guardianHash !== authorization.guardianEvidenceHash
    || riskHash !== authorization.riskEvidenceHash
    || idempotencyHash !== authorization.idempotencyEvidenceHash
  ) {
    throw new BitgetDemoControlBindingConflictError(
      'current control sources do not match the reviewed authorization evidence',
    )
  }
  return {
    assessment,
    riskDecision,
    riskDecisionHash,
    scopes,
    scopesJson,
    scopeSetHash,
    guardianStateHash,
    idempotency,
    idempotencyKeyHash,
    evidence,
  }
}

function bindingBase(input: {
  bindingId: string
  authorization: VerifiedBitgetDemoDispatchAuthorization
  candidate: BitgetUnsignedMutationCandidate
  prepared: PreparedSources
  boundAt: string
}): BindingHashBase {
  return Object.freeze({
    bindingId: input.bindingId,
    authorizationId: input.authorization.authorizationId,
    dispatchAttemptId: input.authorization.dispatchAttemptId,
    exchangeAccountId: input.authorization.exchangeAccountId,
    candidateHash: input.candidate.candidateHash,
    operation: 'PLACE',
    productSymbol: productSymbol(input.candidate),
    assessmentId: input.prepared.assessment.assessment_id,
    assessmentEvidenceHash: input.prepared.assessment.evidence_hash,
    previewHash: input.prepared.assessment.preview_hash,
    riskDecisionId: input.prepared.riskDecision.decisionId,
    riskConfigurationVersion: input.prepared.riskDecision.configurationVersion,
    riskDecisionHash: input.prepared.riskDecisionHash,
    guardianScopes: input.prepared.scopes,
    guardianScopeSetHash: input.prepared.scopeSetHash,
    guardianReviewedStateHash: input.prepared.guardianStateHash,
    idempotencyOperationId: input.prepared.idempotency.operation_id,
    idempotencyOperationScope: input.prepared.idempotency.operation_scope,
    idempotencyKeyHash: input.prepared.idempotencyKeyHash,
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

function parseStoredScopes(json: string): readonly BitgetDemoGuardianScope[] {
  let value: unknown
  try {
    value = JSON.parse(json) as unknown
  } catch {
    throw new BitgetDemoControlBindingConflictError('stored Guardian scope set is malformed')
  }
  if (!Array.isArray(value)) {
    throw new BitgetDemoControlBindingConflictError('stored Guardian scope set is invalid')
  }
  return Object.freeze(value.map((scope) => {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
      throw new BitgetDemoControlBindingConflictError('stored Guardian scope entry is invalid')
    }
    const row = scope as Record<string, unknown>
    return Object.freeze({
      scopeType: String(row.scopeType ?? '') as GuardianScopeType,
      scopeKey: String(row.scopeKey ?? ''),
    })
  }))
}

function baseFromRow(row: BindingRow): BindingHashBase {
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
    guardianScopes: parseStoredScopes(row.guardian_scopes_json),
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
    throw new BitgetDemoControlBindingConflictError('stored control binding capability locks are invalid')
  }
}

async function assertStoredRow(row: BindingRow, expected?: BindingHashBase): Promise<void> {
  assertRowLocks(row)
  const base = baseFromRow(row)
  if (await canonicalHash(base) !== requiredHash(row.control_binding_hash, 'control binding hash')) {
    throw new BitgetDemoControlBindingConflictError('stored control binding hash is invalid')
  }
  if (expected !== undefined && canonicalJson(base) !== canonicalJson(expected)) {
    throw new BitgetDemoControlBindingConflictError('stored control binding conflicts with reviewed sources')
  }
}

async function loadBindingRow(
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
    SELECT binding_id, authorization_id, dispatch_attempt_id,
           exchange_account_id, candidate_hash, operation, product_symbol,
           assessment_id, assessment_evidence_hash, preview_hash,
           risk_decision_id, risk_configuration_version, risk_decision_hash,
           guardian_scopes_json, guardian_scope_count, guardian_scope_set_hash,
           guardian_reviewed_state_hash, idempotency_operation_id,
           idempotency_operation_scope, idempotency_key_hash,
           control_binding_hash, environment, source_only,
           provider_mutation_allowed, execution_allowed, live_execution_allowed,
           real_funds_allowed, mainnet_allowed, withdrawals_allowed,
           automatic_retry_allowed, accounting_automatically_dispatched,
           bound_at
      FROM live_bitget_demo_place_control_bindings
     WHERE binding_id = ? OR authorization_id = ? OR dispatch_attempt_id = ?
        OR candidate_hash = ? OR control_binding_hash = ?
     LIMIT 1
  `).bind(
    identity.bindingId,
    identity.authorizationId,
    identity.dispatchAttemptId,
    identity.candidateHash,
    identity.controlBindingHash ?? '',
  ).first<BindingRow>()
}

function receipt(
  projectionStatus: 'PROJECTED' | 'REPLAYED',
  base: BindingHashBase,
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
  const bindingId = requiredIdentifier(input.bindingId, 'bindingId')
  const assessmentId = requiredIdentifier(input.assessmentId, 'assessmentId')
  const idempotencyOperationId = requiredIdentifier(input.idempotencyOperationId, 'idempotencyOperationId')
  const boundAt = requiredIso(input.boundAt, 'boundAt')
  await loadReviewedBitgetDemoDispatchAuthorization(
    env,
    candidate,
    authorization.authorizationId,
    authorization.dispatchAttemptId,
    boundAt,
  )
  const prepared = await prepareSources(
    env,
    candidate,
    authorization,
    assessmentId,
    idempotencyOperationId,
    input.guardianScopes,
    boundAt,
  )
  const base = bindingBase({ bindingId, authorization, candidate, prepared, boundAt })
  const controlBindingHash = await canonicalHash(base)
  const existing = await loadBindingRow(env, {
    bindingId,
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    candidateHash: candidate.candidateHash,
    controlBindingHash,
  })
  if (existing) {
    await assertStoredRow(existing, base)
    return receipt('REPLAYED', base, controlBindingHash)
  }
  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_place_control_bindings (
        binding_id, authorization_id, dispatch_attempt_id,
        exchange_account_id, candidate_hash, operation, product_symbol,
        assessment_id, assessment_evidence_hash, preview_hash,
        risk_decision_id, risk_configuration_version, risk_decision_hash,
        guardian_scopes_json, guardian_scope_count, guardian_scope_set_hash,
        guardian_reviewed_state_hash, idempotency_operation_id,
        idempotency_operation_scope, idempotency_key_hash,
        control_binding_hash, environment, source_only,
        provider_mutation_allowed, execution_allowed, live_execution_allowed,
        real_funds_allowed, mainnet_allowed, withdrawals_allowed,
        automatic_retry_allowed, accounting_automatically_dispatched, bound_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'PLACE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'BITGET_DEMO', 1, 0, 0, 0, 0, 0, 0, 0, 0, ?
      )
    `).bind(
      base.bindingId,
      base.authorizationId,
      base.dispatchAttemptId,
      base.exchangeAccountId,
      base.candidateHash,
      base.productSymbol,
      base.assessmentId,
      base.assessmentEvidenceHash,
      base.previewHash,
      base.riskDecisionId,
      base.riskConfigurationVersion,
      base.riskDecisionHash,
      prepared.scopesJson,
      base.guardianScopes.length,
      base.guardianScopeSetHash,
      base.guardianReviewedStateHash,
      base.idempotencyOperationId,
      base.idempotencyOperationScope,
      base.idempotencyKeyHash,
      controlBindingHash,
      base.boundAt,
    ).run()
  } catch {
    throw new BitgetDemoControlBindingConflictError('immutable control binding insert was rejected')
  }
  const stored = await loadBindingRow(env, {
    bindingId,
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    candidateHash: candidate.candidateHash,
    controlBindingHash,
  })
  if (!stored) throw new Error('control binding is missing after immutable insert')
  await assertStoredRow(stored, base)
  return receipt('PROJECTED', base, controlBindingHash)
}

export function createD1BitgetDemoFreshControlSource(
  env: BitgetDemoDispatchEvidenceEnv,
): BitgetDemoFreshControlSource {
  const source: BitgetDemoFreshControlSource = {
    async reload(input: FreshReloadInput): Promise<BitgetDemoFreshControlEvidenceInput> {
      assertBitgetDemoDispatchAuthorizationVerified(input.authorization)
      await assertBitgetDemoCandidateIntegrity(input.candidate)
      const evaluatedAt = requiredIso(input.evaluatedAt, 'evaluatedAt')
      const row = await loadBindingRow(env, {
        bindingId: '',
        authorizationId: input.authorization.authorizationId,
        dispatchAttemptId: input.authorization.dispatchAttemptId,
        candidateHash: input.candidate.candidateHash,
      })
      if (!row) throw new BitgetDemoControlBindingConflictError('immutable place control binding is missing')
      await assertStoredRow(row)
      if (
        row.authorization_id !== input.authorization.authorizationId
        || row.dispatch_attempt_id !== input.authorization.dispatchAttemptId
        || row.exchange_account_id !== input.authorization.exchangeAccountId
        || row.candidate_hash !== input.candidate.candidateHash
        || row.operation !== input.candidate.operation
        || row.product_symbol !== productSymbol(input.candidate)
      ) {
        throw new BitgetDemoControlBindingConflictError('immutable place control binding identity mismatch')
      }
      const prepared = await prepareSources(
        env,
        input.candidate,
        input.authorization,
        row.assessment_id,
        row.idempotency_operation_id,
        parseStoredScopes(row.guardian_scopes_json),
        evaluatedAt,
      )
      const evaluatedAtMs = Date.parse(evaluatedAt)
      const decidedAtMs = Date.parse(prepared.riskDecision.decidedAt)
      if (decidedAtMs > evaluatedAtMs || evaluatedAtMs - decidedAtMs > MAX_FRESH_RISK_AGE_MS) {
        throw new BitgetDemoControlBindingConflictError('risk decision is too old for demo certification')
      }
      if (
        prepared.guardianStateHash !== row.guardian_reviewed_state_hash
        || prepared.riskDecisionHash !== row.risk_decision_hash
        || prepared.idempotency.operation_scope !== row.idempotency_operation_scope
        || prepared.idempotencyKeyHash !== row.idempotency_key_hash
      ) {
        throw new BitgetDemoControlBindingConflictError('fresh control source changed after review')
      }
      return prepared.evidence
    },
  }
  return Object.freeze(source)
}
