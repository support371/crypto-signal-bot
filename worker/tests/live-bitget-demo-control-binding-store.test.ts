import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash, canonicalJson, sha256Hex } from '../src/live/canonical-json.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import { bitgetDemoControlEvidenceBindingHash } from '../src/live/adapters/bitget/demo-certification-runner.ts'
import {
  BitgetDemoControlBindingConflictError,
  createD1BitgetDemoFreshControlSource,
  type BitgetDemoGuardianScope,
} from '../src/live/adapters/bitget/demo-control-binding-store.ts'
import { verifyBitgetDemoDispatchAuthorization } from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  buildBitgetPlaceOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const ACCOUNT_ID = 'bitget-demo-account-0001'
const ASSESSMENT_ID = 'assessment-demo-place-0001'
const OPERATION_ID = 'idempotency-operation-0001'
const IDEMPOTENCY_KEY = 'demo-place-idempotency-0001'
const PREVIEW_HASH = '1'.repeat(64)
const ASSESSMENT_HASH = '2'.repeat(64)
const REQUEST_HASH = '3'.repeat(64)
const RELOAD_AT = '2026-07-19T10:00:30.000Z'
const BOUND_AT = '2026-07-19T10:00:29.000Z'

function locks() {
  return {
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
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
    expiresAt: '2026-07-19T10:02:00.000Z',
  }
}

function guardianScopes(): readonly BitgetDemoGuardianScope[] {
  return Object.freeze([
    { scopeType: 'GLOBAL', scopeKey: 'global' },
    { scopeType: 'ENVIRONMENT', scopeKey: 'BITGET_DEMO' },
    { scopeType: 'EXCHANGE', scopeKey: 'BITGET' },
    { scopeType: 'ACCOUNT', scopeKey: ACCOUNT_ID },
    { scopeType: 'SYMBOL', scopeKey: 'BTCUSDT' },
    { scopeType: 'ORDER_TYPE', scopeKey: 'MARKET' },
  ].sort((a, b) => a.scopeType.localeCompare(b.scopeType) || a.scopeKey.localeCompare(b.scopeKey)))
}

class FakeD1 {
  assessment: Record<string, unknown>
  idempotency: Record<string, unknown>
  binding: Record<string, unknown>
  guardians = new Map<string, Record<string, unknown>>()

  constructor(input: {
    assessment: Record<string, unknown>
    idempotency: Record<string, unknown>
    binding: Record<string, unknown>
    guardians: readonly Record<string, unknown>[]
  }) {
    this.assessment = input.assessment
    this.idempotency = input.idempotency
    this.binding = input.binding
    for (const row of input.guardians) {
      this.guardians.set(`${String(row.scope_type)}:${String(row.scope_key)}`, row)
    }
  }

  prepare(sql: string): D1PreparedStatement {
    const database = this
    let values: unknown[] = []
    const statement = {
      bind(...next: unknown[]) {
        values = next
        return statement
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM live_bitget_demo_place_control_bindings')) {
          const keys = values.map(String)
          const row = database.binding
          return (keys.includes(String(row.binding_id))
            || keys.includes(String(row.authorization_id))
            || keys.includes(String(row.dispatch_attempt_id))
            || keys.includes(String(row.candidate_hash))
            || keys.includes(String(row.control_binding_hash))) ? row as T : null
        }
        if (sql.includes('FROM live_candidate_assessments')) {
          return String(values[0]) === database.assessment.assessment_id ? database.assessment as T : null
        }
        if (sql.includes('FROM idempotency_records')) {
          return String(values[0]) === database.idempotency.operation_id ? database.idempotency as T : null
        }
        if (sql.includes('FROM live_guardian_states')) {
          return (database.guardians.get(`${String(values[0])}:${String(values[1])}`) ?? null) as T | null
        }
        return null
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] } as D1Result<T>
      },
      async run(): Promise<D1Result> {
        return {} as D1Result
      },
    }
    return statement as unknown as D1PreparedStatement
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

async function fixture(decidedAt = '2026-07-19T10:00:28.500Z') {
  const candidate: BitgetUnsignedMutationCandidate = await buildBitgetPlaceOrderCandidate({
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
    builtAt: '2026-07-19T10:00:00.000Z',
    expiresAt: '2026-07-19T10:02:00.000Z',
  })

  const scopes = guardianScopes()
  const guardianRows = scopes.map((scope) => ({
    scope_type: scope.scopeType,
    scope_key: scope.scopeKey,
    status: 'CLEAR',
    version: 1,
    updated_at: '2026-07-19T10:00:28.000Z',
  }))
  const guardianSnapshot = guardianRows.map((row) => ({
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    status: 'CLEAR' as const,
    version: row.version,
    updatedAt: row.updated_at,
  }))
  const guardianStateHash = await canonicalHash(guardianSnapshot)
  const scopeSetHash = await canonicalHash(scopes)
  const idempotencyKeyHash = await sha256Hex(IDEMPOTENCY_KEY)
  const risk = Object.freeze({
    decisionId: 'risk-decision-control-0001',
    approved: true,
    rules: Object.freeze([]),
    configurationVersion: 'risk-v1',
    decidedAt,
  })
  const riskHash = await canonicalHash(risk)

  const common = {
    schemaVersion: 1 as const,
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: ACCOUNT_ID,
    candidateHash: candidate.candidateHash,
    operation: 'PLACE' as const,
    productSymbol: 'BTCUSDT',
    reloadedAt: RELOAD_AT,
    ...locks(),
  }
  const controlEvidence = {
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
      decisionId: risk.decisionId,
      configurationVersion: risk.configurationVersion,
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
  const authorization = verifyBitgetDemoDispatchAuthorization({
    authorizationId: 'demo-authorization-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    exchangeAccountId: ACCOUNT_ID,
    actorId: 'risk-approver-0001',
    preparerId: 'candidate-preparer-0001',
    candidateHash: candidate.candidateHash,
    authorizationEvidenceHash: '4'.repeat(64),
    stepUpEvidenceHash: '5'.repeat(64),
    riskEvidenceHash: await bitgetDemoControlEvidenceBindingHash(controlEvidence.risk),
    guardianEvidenceHash: await bitgetDemoControlEvidenceBindingHash(controlEvidence.guardian),
    idempotencyEvidenceHash: await bitgetDemoControlEvidenceBindingHash(controlEvidence.idempotency),
    validFrom: '2026-07-19T10:00:10.000Z',
    expiresAt: '2026-07-19T10:01:10.000Z',
    environment: 'BITGET_DEMO',
    accountCoordinatorSerialized: true,
    guardianClear: true,
    riskApproved: true,
    idempotencyClaimed: true,
    demoMutationReviewed: true,
    liveReleasePresent: false,
    ...locks(),
  })

  const bindingBase = Object.freeze({
    bindingId: 'demo-control-binding-0001',
    authorizationId: authorization.authorizationId,
    dispatchAttemptId: authorization.dispatchAttemptId,
    exchangeAccountId: ACCOUNT_ID,
    candidateHash: candidate.candidateHash,
    operation: 'PLACE' as const,
    productSymbol: 'BTCUSDT',
    assessmentId: ASSESSMENT_ID,
    assessmentEvidenceHash: ASSESSMENT_HASH,
    previewHash: PREVIEW_HASH,
    riskDecisionId: risk.decisionId,
    riskConfigurationVersion: risk.configurationVersion,
    riskDecisionHash: riskHash,
    guardianScopes: scopes,
    guardianScopeSetHash: scopeSetHash,
    guardianReviewedStateHash: guardianStateHash,
    idempotencyOperationId: OPERATION_ID,
    idempotencyOperationScope: 'BITGET_DEMO_PLACE',
    idempotencyKeyHash,
    environment: 'BITGET_DEMO' as const,
    sourceOnly: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
    accountingAutomaticallyDispatched: false as const,
    boundAt: BOUND_AT,
  })

  const database = new FakeD1({
    assessment: {
      assessment_id: ASSESSMENT_ID,
      exchange_account_id: ACCOUNT_ID,
      provider: 'BITGET',
      idempotency_key: IDEMPOTENCY_KEY,
      preview_hash: PREVIEW_HASH,
      evidence_hash: ASSESSMENT_HASH,
      status: 'READY_BUT_EXECUTION_LOCKED',
      operational_checks_passed: 1,
      execution_allowed: 0,
      risk_decision_json: JSON.stringify(risk),
      committed_at: '2026-07-19T10:00:27.000Z',
    },
    idempotency: {
      operation_scope: 'BITGET_DEMO_PLACE',
      idempotency_key: IDEMPOTENCY_KEY,
      request_hash: REQUEST_HASH,
      operation_id: OPERATION_ID,
      exchange_account_id: ACCOUNT_ID,
      status: 'CLAIMED',
      response_json: null,
      error_code: null,
      expires_at: '2026-07-19T10:02:00.000Z',
    },
    guardians: guardianRows,
    binding: {
      binding_id: bindingBase.bindingId,
      authorization_id: bindingBase.authorizationId,
      dispatch_attempt_id: bindingBase.dispatchAttemptId,
      exchange_account_id: bindingBase.exchangeAccountId,
      candidate_hash: bindingBase.candidateHash,
      operation: 'PLACE',
      product_symbol: bindingBase.productSymbol,
      assessment_id: bindingBase.assessmentId,
      assessment_evidence_hash: bindingBase.assessmentEvidenceHash,
      preview_hash: bindingBase.previewHash,
      risk_decision_id: bindingBase.riskDecisionId,
      risk_configuration_version: bindingBase.riskConfigurationVersion,
      risk_decision_hash: bindingBase.riskDecisionHash,
      guardian_scopes_json: canonicalJson(scopes),
      guardian_scope_count: scopes.length,
      guardian_scope_set_hash: bindingBase.guardianScopeSetHash,
      guardian_reviewed_state_hash: bindingBase.guardianReviewedStateHash,
      idempotency_operation_id: bindingBase.idempotencyOperationId,
      idempotency_operation_scope: bindingBase.idempotencyOperationScope,
      idempotency_key_hash: bindingBase.idempotencyKeyHash,
      control_binding_hash: await canonicalHash(bindingBase),
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
      bound_at: BOUND_AT,
    },
  })
  return { database, candidate, authorization }
}

test('reloads the exact immutable Guardian, risk and idempotency controls', async () => {
  const { database, candidate, authorization } = await fixture()
  const evidence = await createD1BitgetDemoFreshControlSource(database.env()).reload({
    candidate,
    authorization,
    evaluatedAt: RELOAD_AT,
  })
  assert.equal(evidence.guardian.status, 'CLEAR')
  assert.equal(evidence.risk.approved, true)
  assert.equal(evidence.idempotency.status, 'CLAIMED')
  assert.equal(evidence.liveExecutionAllowed, undefined)
})

test('rejects Guardian drift after the reviewed binding', async () => {
  const { database, candidate, authorization } = await fixture()
  database.guardians.get(`ACCOUNT:${ACCOUNT_ID}`)!.version = 2
  await assert.rejects(
    createD1BitgetDemoFreshControlSource(database.env()).reload({
      candidate,
      authorization,
      evaluatedAt: RELOAD_AT,
    }),
    /current controls do not match|changed after review/,
  )
})

test('rejects stale risk decisions', async () => {
  const { database, candidate, authorization } = await fixture('2026-07-19T10:00:20.000Z')
  await assert.rejects(
    createD1BitgetDemoFreshControlSource(database.env()).reload({
      candidate,
      authorization,
      evaluatedAt: RELOAD_AT,
    }),
    /risk decision is too old/,
  )
})

test('rejects completed idempotency and corrupted capability locks', async () => {
  const completed = await fixture()
  completed.database.idempotency.status = 'SUCCEEDED'
  await assert.rejects(
    createD1BitgetDemoFreshControlSource(completed.database.env()).reload({
      candidate: completed.candidate,
      authorization: completed.authorization,
      evaluatedAt: RELOAD_AT,
    }),
    /not an active claim/,
  )

  const corrupted = await fixture()
  corrupted.database.binding.execution_allowed = 1
  await assert.rejects(
    createD1BitgetDemoFreshControlSource(corrupted.database.env()).reload({
      candidate: corrupted.candidate,
      authorization: corrupted.authorization,
      evaluatedAt: RELOAD_AT,
    }),
    BitgetDemoControlBindingConflictError,
  )
})
