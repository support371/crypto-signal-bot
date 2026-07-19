import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash, sha256Hex } from '../src/live/canonical-json.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import {
  bitgetDemoControlEvidenceBindingHash,
} from '../src/live/adapters/bitget/demo-certification-runner.ts'
import {
  BitgetDemoControlBindingConflictError,
  createD1BitgetDemoFreshControlSource,
  recordBitgetDemoPlaceControlBinding,
  type BitgetDemoGuardianScope,
} from '../src/live/adapters/bitget/demo-control-binding-store.ts'
import {
  recordReviewedBitgetDemoDispatchAuthorization,
} from '../src/live/adapters/bitget/demo-dispatch-evidence-store.ts'
import {
  verifyBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchAuthorizationInput,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  buildBitgetCancelOrderCandidate,
  buildBitgetPlaceOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const BUILT_AT = '2026-07-19T10:00:00.000Z'
const BOUND_AT = '2026-07-19T10:00:29.000Z'
const RELOAD_AT = '2026-07-19T10:00:30.000Z'
const EXPIRES_AT = '2026-07-19T10:02:00.000Z'
const ACCOUNT_ID = 'bitget-demo-account-0001'
const ASSESSMENT_ID = 'assessment-demo-place-0001'
const OPERATION_ID = 'idempotency-operation-0001'
const IDEMPOTENCY_KEY = 'demo-place-idempotency-0001'
const PREVIEW_HASH = '1'.repeat(64)
const ASSESSMENT_HASH = '2'.repeat(64)
const REQUEST_HASH = '3'.repeat(64)
const AUTHORIZATION_EVENT_HASH = '4'.repeat(64)
const STEP_UP_HASH = '5'.repeat(64)

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

class FakeD1 {
  context: Record<string, unknown>
  authorizations: Record<string, unknown>[] = []
  bindings: Record<string, unknown>[] = []
  assessment: Record<string, unknown>
  idempotency: Record<string, unknown>
  guardians = new Map<string, Record<string, unknown>>()

  constructor(riskDecision: Readonly<Record<string, unknown>>) {
    this.context = {
      authorization_event_id: 'demo-authorization-0001',
      actor_id: 'risk-approver-0001',
      action: 'BITGET_DEMO_DISPATCH',
      resource_type: 'BITGET_DEMO_CANDIDATE',
      resource_id: '',
      required_roles_json: JSON.stringify(['RISK_OPERATOR']),
      actor_roles_json: JSON.stringify(['RISK_OPERATOR']),
      step_up_required: 1,
      step_up_session_id: 'step-up-session-0001',
      decision: 'ALLOW',
      audit_event_hash: AUTHORIZATION_EVENT_HASH,
      occurred_at: '2026-07-19T10:00:05.000Z',
      step_up_actor_id: 'risk-approver-0001',
      assurance_level: 'AAL2',
      audience: 'BITGET_DEMO_DISPATCH',
      issued_at: '2026-07-19T10:00:00.000Z',
      step_up_expires_at: '2026-07-19T10:03:00.000Z',
      revoked_at: null,
      session_hash: STEP_UP_HASH,
    }
    this.assessment = {
      assessment_id: ASSESSMENT_ID,
      exchange_account_id: ACCOUNT_ID,
      provider: 'BITGET',
      idempotency_key: IDEMPOTENCY_KEY,
      preview_hash: PREVIEW_HASH,
      evidence_hash: ASSESSMENT_HASH,
      status: 'READY_BUT_EXECUTION_LOCKED',
      operational_checks_passed: 1,
      execution_allowed: 0,
      risk_decision_json: JSON.stringify(riskDecision),
      committed_at: '2026-07-19T10:00:27.000Z',
    }
    this.idempotency = {
      operation_scope: 'BITGET_DEMO_PLACE',
      idempotency_key: IDEMPOTENCY_KEY,
      request_hash: REQUEST_HASH,
      operation_id: OPERATION_ID,
      exchange_account_id: ACCOUNT_ID,
      status: 'CLAIMED',
      response_json: null,
      error_code: null,
      expires_at: '2026-07-19T10:02:00.000Z',
    }
  }

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const statement = (params: unknown[] = []): FakeStatement => ({
      sql,
      params,
      bind: (...next: unknown[]) => statement(next),
      first: async <T>() => database.first<T>(sql, params),
      all: async <T>() => ({ results: [] } as D1Result<T>),
      run: async () => database.run(sql, params),
    })
    return statement() as unknown as D1PreparedStatement
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes('FROM live_authorization_events authorization')) return this.context as T
    if (sql.includes('FROM live_bitget_demo_dispatch_authorizations')) {
      const [authorizationId, attemptId, candidateHash, authorizationHash] = params.map(String)
      return (this.authorizations.find((row) => (
        row.authorization_id === authorizationId
        || row.dispatch_attempt_id === attemptId
        || row.candidate_hash === candidateHash
        || row.authorization_hash === authorizationHash
      )) ?? null) as T | null
    }
    if (sql.includes('FROM live_candidate_assessments')) {
      return String(params[0]) === this.assessment.assessment_id ? this.assessment as T : null
    }
    if (sql.includes('FROM idempotency_records')) {
      return String(params[0]) === this.idempotency.operation_id ? this.idempotency as T : null
    }
    if (sql.includes('FROM live_guardian_states')) {
      return (this.guardians.get(`${String(params[0])}:${String(params[1])}`) ?? null) as T | null
    }
    if (sql.includes('FROM live_bitget_demo_place_control_bindings')) {
      const [bindingId, authorizationId, attemptId, candidateHash, bindingHash] = params.map(String)
      return (this.bindings.find((row) => (
        row.binding_id === bindingId
        || row.authorization_id === authorizationId
        || row.dispatch_attempt_id === attemptId
        || row.candidate_hash === candidateHash
        || row.control_binding_hash === bindingHash
      )) ?? null) as T | null
    }
    return null
  }

  async run(sql: string, params: unknown[]): Promise<D1Result> {
    if (sql.includes('INSERT INTO live_bitget_demo_dispatch_authorizations')) {
      if (this.authorizations.length > 0) throw new Error('authorization uniqueness conflict')
      this.authorizations.push({
        authorization_id: String(params[0]),
        dispatch_attempt_id: String(params[1]),
        exchange_account_id: String(params[2]),
        candidate_hash: String(params[3]),
        operation: String(params[4]),
        endpoint: String(params[5]),
        product_symbol: String(params[6]),
        actor_id: String(params[7]),
        preparer_id: String(params[8]),
        authorization_evidence_hash: String(params[9]),
        step_up_evidence_hash: String(params[10]),
        risk_evidence_hash: String(params[11]),
        guardian_evidence_hash: String(params[12]),
        idempotency_evidence_hash: String(params[13]),
        valid_from: String(params[14]),
        expires_at: String(params[15]),
        validity_seconds: Number(params[16]),
        authorization_hash: String(params[17]),
        environment: 'BITGET_DEMO',
        account_coordinator_serialized: 1,
        guardian_clear: 1,
        risk_approved: 1,
        idempotency_claimed: 1,
        demo_mutation_reviewed: 1,
        live_release_present: 0,
        live_execution_allowed: 0,
        real_funds_allowed: 0,
        mainnet_allowed: 0,
        withdrawals_allowed: 0,
        automatically_retried: 0,
        reviewed_at: String(params[18]),
      })
    }
    if (sql.includes('INSERT INTO live_bitget_demo_place_control_bindings')) {
      if (this.bindings.length > 0) throw new Error('binding uniqueness conflict')
      this.bindings.push({
        binding_id: String(params[0]),
        authorization_id: String(params[1]),
        dispatch_attempt_id: String(params[2]),
        exchange_account_id: String(params[3]),
        candidate_hash: String(params[4]),
        operation: 'PLACE',
        product_symbol: String(params[5]),
        assessment_id: String(params[6]),
        assessment_evidence_hash: String(params[7]),
        preview_hash: String(params[8]),
        risk_decision_id: String(params[9]),
        risk_configuration_version: String(params[10]),
        risk_decision_hash: String(params[11]),
        guardian_scopes_json: String(params[12]),
        guardian_scope_count: Number(params[13]),
        guardian_scope_set_hash: String(params[14]),
        guardian_reviewed_state_hash: String(params[15]),
        idempotency_operation_id: String(params[16]),
        idempotency_operation_scope: String(params[17]),
        idempotency_key_hash: String(params[18]),
        control_binding_hash: String(params[19]),
        environment: 'BITGET_DEMO',
        source_only: 1,
        provider_mutation_allowed: 0,
        execution_allowed: 0,
        live_execution_allowed: 0,
        real_funds_allowed: 0,
        mainnet_allowed: 0,
        withdrawals_allowed: 0,
        automatic_retry_allowed: 0,
        accounting_automatically_dispatched: 0,
        bound_at: String(params[20]),
      })
    }
    return {} as D1Result
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

function productRules(): ProductRules {
  return {
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    baseIncrement: asDecimalString('0.00000001'),
    quoteIncrement: asDecimalString('0.01'),
    priceIncrement: asDecimalString('0.01'),
    minimumBaseSize: asDecimalString('0.0001'),
    maximumBaseSize: asDecimalString('10'),
    minimumQuoteSize: asDecimalString('5'),
    tradingEnabled: true,
    supportedOrderTypes: ['MARKET', 'LIMIT'],
    observedAt: '2026-07-19T09:59:00.000Z',
    expiresAt: EXPIRES_AT,
  }
}

async function placeCandidate(): Promise<BitgetUnsignedMutationCandidate> {
  return buildBitgetPlaceOrderCandidate({
    request: {
      productId: 'BTC-USDT',
      side: 'BUY',
      orderType: 'MARKET',
      baseQuantity: null,
      quoteNotional: asDecimalString('100'),
      limitPrice: null,
      stopPrice: null,
    },
    productRules: productRules(),
    clientOrderId: 'demo-place-control-0001',
    previewHash: PREVIEW_HASH,
    force: 'gtc',
    builtAt: BUILT_AT,
    expiresAt: EXPIRES_AT,
  })
}

function scopes(): readonly BitgetDemoGuardianScope[] {
  return Object.freeze([
    { scopeType: 'GLOBAL', scopeKey: 'global' },
    { scopeType: 'ENVIRONMENT', scopeKey: 'BITGET_DEMO' },
    { scopeType: 'EXCHANGE', scopeKey: 'BITGET' },
    { scopeType: 'ACCOUNT', scopeKey: ACCOUNT_ID },
    { scopeType: 'SYMBOL', scopeKey: 'BTCUSDT' },
    { scopeType: 'ORDER_TYPE', scopeKey: 'MARKET' },
  ])
}

function riskDecision(decidedAt = '2026-07-19T10:00:28.500Z') {
  return Object.freeze({
    decisionId: 'risk-decision-control-0001',
    approved: true,
    rules: Object.freeze([]),
    configurationVersion: 'risk-v1',
    decidedAt,
  })
}

async function prepared(decidedAt?: string) {
  const current = await placeCandidate()
  const database = new FakeD1(riskDecision(decidedAt))
  database.context.resource_id = current.candidateHash
  const normalizedScopes = [...scopes()].sort((a, b) => (
    a.scopeType.localeCompare(b.scopeType) || a.scopeKey.localeCompare(b.scopeKey)
  ))
  const guardianSnapshot = normalizedScopes.map((scope) => {
    const row = {
      scope_type: scope.scopeType,
      scope_key: scope.scopeKey,
      status: 'CLEAR',
      version: 1,
      updated_at: '2026-07-19T10:00:28.000Z',
    }
    database.guardians.set(`${scope.scopeType}:${scope.scopeKey}`, row)
    return {
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      status: 'CLEAR' as const,
      version: 1,
      updatedAt: row.updated_at,
    }
  })
  const guardianStateHash = await canonicalHash(guardianSnapshot)
  const idempotencyKeyHash = await sha256Hex(IDEMPOTENCY_KEY)
  const common = {
    schemaVersion: 1 as const,
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: ACCOUNT_ID,
    candidateHash: current.candidateHash,
    operation: 'PLACE' as const,
    productSymbol: 'BTCUSDT',
    reloadedAt: BOUND_AT,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  }
  const evidence = {
    guardian: Object.freeze({
      ...common,
      evidenceType: 'GUARDIAN' as const,
      status: 'CLEAR' as const,
      actionAllowed: true as const,
      stateVersionHash: guardianStateHash,
    }),
    risk: Object.freeze({
      ...common,
      evidenceType: 'RISK' as const,
      decisionId: 'risk-decision-control-0001',
      configurationVersion: 'risk-v1',
      approved: true as const,
    }),
    idempotency: Object.freeze({
      ...common,
      evidenceType: 'IDEMPOTENCY' as const,
      authorizationId: 'demo-authorization-0001',
      dispatchAttemptId: 'demo-attempt-0001',
      claimId: OPERATION_ID,
      idempotencyKeyHash,
      status: 'CLAIMED' as const,
    }),
  }
  const input: BitgetDemoDispatchAuthorizationInput = {
    authorizationId: 'demo-authorization-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    exchangeAccountId: ACCOUNT_ID,
    actorId: 'risk-approver-0001',
    preparerId: 'candidate-preparer-0001',
    candidateHash: current.candidateHash,
    authorizationEvidenceHash: AUTHORIZATION_EVENT_HASH,
    stepUpEvidenceHash: STEP_UP_HASH,
    riskEvidenceHash: await bitgetDemoControlEvidenceBindingHash(evidence.risk),
    guardianEvidenceHash: await bitgetDemoControlEvidenceBindingHash(evidence.guardian),
    idempotencyEvidenceHash: await bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
    validFrom: '2026-07-19T10:00:10.000Z',
    expiresAt: '2026-07-19T10:01:10.000Z',
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
  await recordReviewedBitgetDemoDispatchAuthorization(database.env(), current, input, '2026-07-19T10:00:06.000Z')
  return {
    database,
    current,
    authorization: verifyBitgetDemoDispatchAuthorization(input),
  }
}

const bindingInput = Object.freeze({
  bindingId: 'demo-control-binding-0001',
  assessmentId: ASSESSMENT_ID,
  idempotencyOperationId: OPERATION_ID,
  guardianScopes: scopes(),
  boundAt: BOUND_AT,
})

test('projects and exactly replays one immutable place-control binding', async () => {
  const { database, current, authorization } = await prepared()
  const projected = await recordBitgetDemoPlaceControlBinding(database.env(), current, authorization, bindingInput)
  const replayed = await recordBitgetDemoPlaceControlBinding(database.env(), current, authorization, bindingInput)

  assert.equal(projected.projectionStatus, 'PROJECTED')
  assert.equal(replayed.projectionStatus, 'REPLAYED')
  assert.equal(replayed.controlBindingHash, projected.controlBindingHash)
  assert.equal(database.bindings.length, 1)
  assert.equal(database.bindings[0]?.execution_allowed, 0)
  assert.equal(database.bindings[0]?.automatic_retry_allowed, 0)
})

test('requires every mandatory Guardian scope', async () => {
  const { database, current, authorization } = await prepared()
  const incomplete = scopes().filter((scope) => scope.scopeType !== 'SYMBOL')
  await assert.rejects(
    recordBitgetDemoPlaceControlBinding(database.env(), current, authorization, {
      ...bindingInput,
      guardianScopes: incomplete,
    }),
    /Guardian scope set is missing SYMBOL:BTCUSDT/,
  )
  assert.equal(database.bindings.length, 0)
})

test('rejects cancel candidates because no authoritative place assessment can bind them', async () => {
  const { database, authorization } = await prepared()
  const cancel = await buildBitgetCancelOrderCandidate({
    productId: 'BTC-USDT',
    identity: { orderId: 'demo-order-0001', clientOrderId: null },
    builtAt: BUILT_AT,
    expiresAt: EXPIRES_AT,
  })
  await assert.rejects(
    recordBitgetDemoPlaceControlBinding(database.env(), cancel, authorization, bindingInput),
    BitgetDemoControlBindingConflictError,
  )
})

test('fresh D1 source reloads matching controls and rejects Guardian drift', async () => {
  const { database, current, authorization } = await prepared()
  await recordBitgetDemoPlaceControlBinding(database.env(), current, authorization, bindingInput)
  const source = createD1BitgetDemoFreshControlSource(database.env())
  const evidence = await source.reload({ current: undefined } as never).catch(() => null)
  assert.equal(evidence, null)

  const currentEvidence = await source.reload({ candidate: current, authorization, evaluatedAt: RELOAD_AT })
  assert.equal(currentEvidence.guardian.status, 'CLEAR')
  assert.equal(currentEvidence.idempotency.status, 'CLAIMED')

  const accountGuardian = database.guardians.get(`ACCOUNT:${ACCOUNT_ID}`)!
  accountGuardian.version = 2
  await assert.rejects(
    source.reload({ candidate: current, authorization, evaluatedAt: RELOAD_AT }),
    /current controls do not match|changed after review/,
  )
})

test('fresh D1 source rejects stale risk and completed idempotency', async () => {
  const stale = await prepared('2026-07-19T10:00:20.000Z')
  await recordBitgetDemoPlaceControlBinding(stale.database.env(), stale.current, stale.authorization, bindingInput)
  await assert.rejects(
    createD1BitgetDemoFreshControlSource(stale.database.env()).reload({
      candidate: stale.current,
      authorization: stale.authorization,
      evaluatedAt: RELOAD_AT,
    }),
    /risk decision is too old/,
  )

  const completed = await prepared()
  await recordBitgetDemoPlaceControlBinding(completed.database.env(), completed.current, completed.authorization, bindingInput)
  completed.database.idempotency.status = 'SUCCEEDED'
  await assert.rejects(
    createD1BitgetDemoFreshControlSource(completed.database.env()).reload({
      candidate: completed.current,
      authorization: completed.authorization,
      evaluatedAt: RELOAD_AT,
    }),
    /not an active claim/,
  )
})
