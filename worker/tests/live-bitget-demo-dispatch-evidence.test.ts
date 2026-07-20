import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import {
  assertBitgetDemoDispatchAuthorizationVerified,
  type BitgetDemoDispatchAuthorizationInput,
  type BitgetDemoDispatchResult,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  BitgetDemoDispatchEvidenceConflictError,
  claimReviewedBitgetDemoDispatchAttempt,
  loadReviewedBitgetDemoDispatchAuthorization,
  persistBitgetDemoDispatchResult,
  recordReviewedBitgetDemoDispatchAuthorization,
} from '../src/live/adapters/bitget/demo-dispatch-evidence-store.ts'
import {
  orchestrateReviewedBitgetDemoDispatch,
} from '../src/live/adapters/bitget/demo-dispatch-orchestrator.ts'
import {
  buildBitgetPlaceOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const NOW = Date.parse('2026-07-18T03:00:30.000Z')
const HASHES = Object.freeze({
  authorization: '1'.repeat(64),
  stepUp: '2'.repeat(64),
  risk: '3'.repeat(64),
  guardian: '4'.repeat(64),
  idempotency: '5'.repeat(64),
  preview: '6'.repeat(64),
  request: '7'.repeat(64),
  rateLimit: '8'.repeat(64),
})

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
  claims: Record<string, unknown>[] = []
  results: Record<string, unknown>[] = []
  lookups: Record<string, unknown>[] = []
  batchCount = 0

  constructor() {
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
      audit_event_hash: HASHES.authorization,
      occurred_at: '2026-07-18T03:00:05.000Z',
      step_up_actor_id: 'risk-approver-0001',
      assurance_level: 'AAL2',
      audience: 'BITGET_DEMO_DISPATCH',
      issued_at: '2026-07-18T03:00:00.000Z',
      step_up_expires_at: '2026-07-18T03:05:10.000Z',
      revoked_at: null,
      session_hash: HASHES.stepUp,
    }
  }

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const statement = (params: unknown[] = []): FakeStatement => ({
      sql,
      params,
      bind: (...next: unknown[]) => statement(next),
      first: async <T>() => database.first<T>(sql, params),
      all: async <T>() => database.all<T>(sql, params),
      run: async () => database.run(sql, params),
    })
    return statement() as unknown as D1PreparedStatement
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes('FROM live_authorization_events authorization')) {
      return this.context as T
    }
    if (sql.includes('FROM live_bitget_demo_dispatch_authorizations')) {
      const [authorizationId, attemptId, candidateHash, authorizationHash] = params.map(String)
      return (this.authorizations.find((row) => (
        row.authorization_id === authorizationId
        || row.dispatch_attempt_id === attemptId
        || row.candidate_hash === candidateHash
        || row.authorization_hash === authorizationHash
      )) ?? null) as T | null
    }
    if (sql.includes('FROM live_bitget_demo_dispatch_claims')) {
      const [attemptId, authorizationId, candidateHash, claimHash] = params.map(String)
      return (this.claims.find((row) => (
        row.dispatch_attempt_id === attemptId
        || row.authorization_id === authorizationId
        || row.candidate_hash === candidateHash
        || row.claim_hash === claimHash
      )) ?? null) as T | null
    }
    if (sql.includes('FROM live_bitget_demo_dispatch_results')) {
      const [attemptId, authorizationId, candidateHash, resultHash] = params.map(String)
      return (this.results.find((row) => (
        row.dispatch_attempt_id === attemptId
        || row.authorization_id === authorizationId
        || row.candidate_hash === candidateHash
        || row.result_hash === resultHash
      )) ?? null) as T | null
    }
    return null
  }

  async all<T>(sql: string, params: unknown[]): Promise<D1Result<T>> {
    if (sql.includes('FROM live_bitget_demo_dispatch_recovery_requirements')) {
      const attemptId = String(params[0])
      return {
        results: this.lookups
          .filter((row) => row.dispatch_attempt_id === attemptId)
          .sort((left, right) => Number(left.lookup_index) - Number(right.lookup_index)),
      } as D1Result<T>
    }
    return { results: [] } as D1Result<T>
  }

  async run(sql: string, params: unknown[]): Promise<D1Result> {
    if (sql.includes('INSERT INTO live_bitget_demo_dispatch_authorizations')) {
      if (this.authorizations.length > 0) throw new Error('fake uniqueness conflict')
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
    if (sql.includes('INSERT INTO live_bitget_demo_dispatch_claims')) {
      if (this.claims.length > 0) throw new Error('fake uniqueness conflict')
      this.claims.push({
        dispatch_attempt_id: String(params[0]),
        authorization_id: String(params[1]),
        exchange_account_id: String(params[2]),
        candidate_hash: String(params[3]),
        authorization_hash: String(params[4]),
        claim_hash: String(params[5]),
        one_shot: 1,
        demo_dispatch_reviewed: 1,
        requires_account_coordinator_serialization: 1,
        live_execution_allowed: 0,
        real_funds_allowed: 0,
        mainnet_allowed: 0,
        withdrawals_allowed: 0,
        automatically_retried: 0,
        claimed_at: String(params[6]),
      })
    }
    if (sql.includes('INSERT INTO live_bitget_demo_dispatch_results')) {
      if (this.results.length > 0) throw new Error('fake uniqueness conflict')
      this.results.push({
        dispatch_attempt_id: String(params[0]),
        authorization_id: String(params[1]),
        exchange_account_id: String(params[2]),
        candidate_hash: String(params[3]),
        operation: String(params[4]),
        endpoint: String(params[5]),
        category: String(params[6]),
        reason: String(params[7]),
        request_body_hash: params[8] as string | null,
        rate_limit_receipt_hash: params[9] as string | null,
        http_status: params[10] as number | null,
        provider_code: params[11] as string | null,
        provider_message: params[12] as string | null,
        acknowledged_order_id: params[13] as string | null,
        acknowledged_client_order_id: params[14] as string | null,
        recovery_lookup_count: Number(params[15]),
        result_json: String(params[16]),
        result_hash: String(params[17]),
        environment: 'BITGET_DEMO',
        demo_request_sent: Number(params[18]),
        demo_provider_mutation_attempted: Number(params[19]),
        requires_read_only_recovery: Number(params[20]),
        provider_acknowledgment_verified: Number(params[21]),
        real_provider_mutation_allowed: 0,
        live_execution_allowed: 0,
        real_funds_allowed: 0,
        mainnet_allowed: 0,
        withdrawals_allowed: 0,
        automatically_retried: 0,
        occurred_at: String(params[22]),
      })
    }
    if (sql.includes('INSERT INTO live_bitget_demo_dispatch_recovery_requirements')) {
      this.lookups.push({
        dispatch_attempt_id: String(params[0]),
        lookup_index: Number(params[1]),
        method: 'GET',
        endpoint: String(params[2]),
        product_symbol: String(params[3]),
        order_id: params[4] as string | null,
        client_order_id: params[5] as string | null,
        lookup_hash: String(params[6]),
        provider_mutation_allowed: 0,
        live_execution_allowed: 0,
        automatically_dispatched: 0,
      })
    }
    return {} as D1Result
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCount += 1
    const results: D1Result[] = []
    for (const statement of statements as unknown as FakeStatement[]) {
      results.push(await this.run(statement.sql, statement.params))
    }
    return results
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
    observedAt: '2026-07-18T02:59:00.000Z',
    expiresAt: '2026-07-18T03:02:00.000Z',
  }
}

async function candidate(): Promise<BitgetUnsignedMutationCandidate> {
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
    clientOrderId: 'demo-place-evidence-0001',
    previewHash: HASHES.preview,
    force: 'gtc',
    builtAt: '2026-07-18T03:00:00.000Z',
    expiresAt: '2026-07-18T03:02:00.000Z',
  })
}

function authorizationInput(
  current: BitgetUnsignedMutationCandidate,
  overrides: Partial<BitgetDemoDispatchAuthorizationInput> = {},
): BitgetDemoDispatchAuthorizationInput {
  return {
    authorizationId: 'demo-authorization-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    exchangeAccountId: 'bitget-demo-account-0001',
    actorId: 'risk-approver-0001',
    preparerId: 'candidate-preparer-0001',
    candidateHash: current.candidateHash,
    authorizationEvidenceHash: HASHES.authorization,
    stepUpEvidenceHash: HASHES.stepUp,
    riskEvidenceHash: HASHES.risk,
    guardianEvidenceHash: HASHES.guardian,
    idempotencyEvidenceHash: HASHES.idempotency,
    validFrom: '2026-07-18T03:00:10.000Z',
    expiresAt: '2026-07-18T03:01:10.000Z',
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
    ...overrides,
  }
}

function acknowledgedResult(current: BitgetUnsignedMutationCandidate): BitgetDemoDispatchResult {
  return Object.freeze({
    environment: 'BITGET_DEMO',
    dispatchAttemptId: 'demo-attempt-0001',
    authorizationId: 'demo-authorization-0001',
    exchangeAccountId: 'bitget-demo-account-0001',
    candidateHash: current.candidateHash,
    operation: current.operation,
    endpoint: current.endpoint,
    category: 'ACKNOWLEDGED',
    reason: 'provider_acknowledgment_identity_verified',
    requestBodyHash: HASHES.request,
    rateLimitReceiptHash: HASHES.rateLimit,
    httpStatus: 200,
    providerCode: '00000',
    providerMessage: 'success',
    acknowledgedOrderId: 'provider-order-0001',
    acknowledgedClientOrderId: 'demo-place-evidence-0001',
    recoveryLookups: Object.freeze([]),
    demoRequestSent: true,
    demoProviderMutationAttempted: true,
    requiresReadOnlyRecovery: false,
    providerAcknowledgmentVerified: true,
    realProviderMutationAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
  })
}

async function prepared() {
  const database = new FakeD1()
  const current = await candidate()
  database.context.resource_id = current.candidateHash
  const input = authorizationInput(current)
  await recordReviewedBitgetDemoDispatchAuthorization(
    database.env(),
    current,
    input,
    '2026-07-18T03:00:06.000Z',
  )
  const reviewed = await loadReviewedBitgetDemoDispatchAuthorization(
    database.env(),
    current,
    input.authorizationId,
    input.dispatchAttemptId,
    new Date(NOW).toISOString(),
  )
  return { database, current, input, reviewed }
}

test('independent role and step-up evidence records one immutable demo authorization', async () => {
  const database = new FakeD1()
  const current = await candidate()
  database.context.resource_id = current.candidateHash
  const input = authorizationInput(current)
  const projected = await recordReviewedBitgetDemoDispatchAuthorization(
    database.env(),
    current,
    input,
    '2026-07-18T03:00:06.000Z',
  )
  const replayed = await recordReviewedBitgetDemoDispatchAuthorization(
    database.env(),
    current,
    input,
    '2026-07-18T03:00:06.000Z',
  )

  assert.equal(projected.projectionStatus, 'PROJECTED')
  assert.equal(replayed.projectionStatus, 'REPLAYED')
  assert.equal(replayed.authorizationHash, projected.authorizationHash)
  assert.equal(database.authorizations.length, 1)
  assert.equal(database.authorizations[0]?.live_execution_allowed, 0)
  assert.equal(database.authorizations[0]?.automatically_retried, 0)
})

test('missing risk role, revoked step-up, or changed resource fails before persistence', async () => {
  const cases: Array<(database: FakeD1) => void> = [
    (database) => { database.context.actor_roles_json = JSON.stringify(['VIEWER']) },
    (database) => { database.context.revoked_at = '2026-07-18T03:00:04.000Z' },
    (database) => { database.context.resource_id = 'f'.repeat(64) },
  ]
  for (const configure of cases) {
    const database = new FakeD1()
    const current = await candidate()
    database.context.resource_id = current.candidateHash
    configure(database)
    await assert.rejects(
      recordReviewedBitgetDemoDispatchAuthorization(
        database.env(),
        current,
        authorizationInput(current),
        '2026-07-18T03:00:06.000Z',
      ),
      BitgetDemoDispatchEvidenceConflictError,
    )
    assert.equal(database.authorizations.length, 0)
  }
})

test('review evidence rejects noncanonical authorization timestamps', async () => {
  const database = new FakeD1()
  const current = await candidate()
  database.context.resource_id = current.candidateHash
  await assert.rejects(
    recordReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      authorizationInput(current, { validFrom: '2026-07-18T03:00:10Z' }),
      '2026-07-18T03:00:06.000Z',
    ),
    /canonical UTC ISO-8601/,
  )
  assert.equal(database.authorizations.length, 0)
})

test('review reload restores a non-enumerable brand that spread and JSON cannot preserve', async () => {
  const { reviewed } = await prepared()
  const descriptors = Object.getOwnPropertySymbols(reviewed.authorization)
    .map((symbol) => Object.getOwnPropertyDescriptor(reviewed.authorization, symbol))
  assert.equal(descriptors.length, 1)
  assert.equal(descriptors[0]?.enumerable, false)
  assert.throws(
    () => assertBitgetDemoDispatchAuthorizationVerified({ ...reviewed.authorization }),
    /in-memory verified authorization/,
  )
  assert.throws(
    () => assertBitgetDemoDispatchAuthorizationVerified(
      JSON.parse(JSON.stringify(reviewed.authorization)) as typeof reviewed.authorization,
    ),
    /in-memory verified authorization/,
  )
})

test('a reviewed demo authorization can be durably claimed exactly once', async () => {
  const { database, reviewed } = await prepared()
  const claim = await claimReviewedBitgetDemoDispatchAttempt(
    database.env(),
    reviewed,
    new Date(NOW).toISOString(),
  )
  assert.equal(claim.oneShot, true)
  assert.equal(claim.demoDispatchReviewed, true)
  assert.equal(claim.automaticallyRetried, false)
  assert.equal(claim.liveExecutionAllowed, false)
  await assert.rejects(
    claimReviewedBitgetDemoDispatchAttempt(
      database.env(),
      reviewed,
      new Date(NOW).toISOString(),
    ),
    /already durably claimed/,
  )
  assert.equal(database.claims.length, 1)
})

test('result summary and recovery requirements persist in one immutable D1 batch', async () => {
  const { database, current, reviewed } = await prepared()
  const claim = await claimReviewedBitgetDemoDispatchAttempt(
    database.env(),
    reviewed,
    new Date(NOW).toISOString(),
  )
  const result: BitgetDemoDispatchResult = Object.freeze({
    ...acknowledgedResult(current),
    category: 'AMBIGUOUS_REQUIRES_LOOKUP',
    reason: 'provider_result_is_ambiguous',
    httpStatus: 400,
    providerCode: '40010',
    providerMessage: 'request timed out',
    acknowledgedOrderId: null,
    acknowledgedClientOrderId: null,
    recoveryLookups: current.recoveryLookups,
    requiresReadOnlyRecovery: true,
    providerAcknowledgmentVerified: false,
  })
  const persisted = await persistBitgetDemoDispatchResult(
    database.env(),
    reviewed,
    claim,
    current,
    result,
    '2026-07-18T03:00:31.000Z',
  )
  const replayed = await persistBitgetDemoDispatchResult(
    database.env(),
    reviewed,
    claim,
    current,
    result,
    '2026-07-18T03:00:31.000Z',
  )

  assert.equal(persisted.projectionStatus, 'PROJECTED')
  assert.equal(replayed.projectionStatus, 'REPLAYED')
  assert.equal(replayed.resultHash, persisted.resultHash)
  assert.equal(database.batchCount, 1)
  assert.equal(database.results.length, 1)
  assert.equal(database.lookups.length, 1)
  assert.equal(database.lookups[0]?.provider_mutation_allowed, 0)
  assert.equal(persisted.automaticallyRetried, false)
})

test('changed result replay and capability tampering fail closed', async () => {
  const { database, current, reviewed } = await prepared()
  const claim = await claimReviewedBitgetDemoDispatchAttempt(
    database.env(),
    reviewed,
    new Date(NOW).toISOString(),
  )
  const result = acknowledgedResult(current)
  await persistBitgetDemoDispatchResult(
    database.env(),
    reviewed,
    claim,
    current,
    result,
    '2026-07-18T03:00:31.000Z',
  )

  await assert.rejects(
    persistBitgetDemoDispatchResult(
      database.env(),
      reviewed,
      claim,
      current,
      { ...result, providerMessage: 'changed result' },
      '2026-07-18T03:00:31.000Z',
    ),
    /conflicts with immutable result evidence/,
  )
  await assert.rejects(
    persistBitgetDemoDispatchResult(
      database.env(),
      reviewed,
      claim,
      current,
      { ...result, liveExecutionAllowed: true as false },
      '2026-07-18T03:00:31.000Z',
    ),
    /capability locks/,
  )
  await assert.rejects(
    persistBitgetDemoDispatchResult(
      database.env(),
      reviewed,
      claim,
      current,
      { ...result, providerMessage: ' success ' },
      '2026-07-18T03:00:31.000Z',
    ),
    /providerMessage is invalid/,
  )
  assert.equal(database.batchCount, 1)
})

test('orchestration serializes by account, claims before dispatch, and never replays', async () => {
  const database = new FakeD1()
  const current = await candidate()
  database.context.resource_id = current.candidateHash
  const input = authorizationInput(current)
  await recordReviewedBitgetDemoDispatchAuthorization(
    database.env(),
    current,
    input,
    '2026-07-18T03:00:06.000Z',
  )
  const serializedAccounts: string[] = []
  let dispatchCount = 0
  const clock = { now: () => new Date(NOW + dispatchCount) }
  const executor = {
    serializer: {
      async run<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
        serializedAccounts.push(accountId)
        return operation()
      },
    },
    async dispatch(): Promise<BitgetDemoDispatchResult> {
      dispatchCount += 1
      assert.equal(database.claims.length, 1)
      return acknowledgedResult(current)
    },
  }
  const outcome = await orchestrateReviewedBitgetDemoDispatch(
    database.env(),
    { authorizationId: input.authorizationId, dispatchAttemptId: input.dispatchAttemptId, candidate: current },
    executor,
    clock,
  )
  assert.equal(outcome.persistence.projectionStatus, 'PROJECTED')
  assert.deepEqual(serializedAccounts, ['bitget-demo-account-0001'])
  assert.equal(dispatchCount, 1)

  await assert.rejects(
    orchestrateReviewedBitgetDemoDispatch(
      database.env(),
      { authorizationId: input.authorizationId, dispatchAttemptId: input.dispatchAttemptId, candidate: current },
      executor,
      clock,
    ),
    /already durably claimed/,
  )
  assert.equal(dispatchCount, 1)
})

test('executor interruption leaves an orphaned claim and cannot trigger automatic retry', async () => {
  const database = new FakeD1()
  const current = await candidate()
  database.context.resource_id = current.candidateHash
  const input = authorizationInput(current)
  await recordReviewedBitgetDemoDispatchAuthorization(
    database.env(),
    current,
    input,
    '2026-07-18T03:00:06.000Z',
  )
  let dispatchCount = 0
  const executor = {
    serializer: { run: async <T>(_accountId: string, operation: () => Promise<T>) => operation() },
    async dispatch(): Promise<BitgetDemoDispatchResult> {
      dispatchCount += 1
      throw new Error('fixture interruption after immutable claim')
    },
  }
  const request = {
    authorizationId: input.authorizationId,
    dispatchAttemptId: input.dispatchAttemptId,
    candidate: current,
  }
  await assert.rejects(
    orchestrateReviewedBitgetDemoDispatch(
      database.env(),
      request,
      executor,
      { now: () => new Date(NOW) },
    ),
    /fixture interruption/,
  )
  await assert.rejects(
    orchestrateReviewedBitgetDemoDispatch(
      database.env(),
      request,
      executor,
      { now: () => new Date(NOW) },
    ),
    /already durably claimed/,
  )
  assert.equal(database.claims.length, 1)
  assert.equal(database.results.length, 0)
  assert.equal(dispatchCount, 1)
})

test('expired or corrupted immutable authorization fails before claim and dispatch', async () => {
  const { database, current, input } = await prepared()
  await assert.rejects(
    loadReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input.authorizationId,
      input.dispatchAttemptId,
      '2026-07-18T03:01:10.000Z',
    ),
    /outside its immutable validity window/,
  )

  database.authorizations[0]!.mainnet_allowed = 1
  await assert.rejects(
    loadReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input.authorizationId,
      input.dispatchAttemptId,
      new Date(NOW).toISOString(),
    ),
    /capability locks/,
  )
  assert.equal(database.claims.length, 0)
})
