import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash } from '../src/live/canonical-json.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import {
  verifyBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchResult,
  type BitgetDemoRateLimitClaimInput,
  type BitgetDemoSigningMaterial,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  assertFreshBitgetDemoControlEvidenceVerified,
  bitgetDemoControlEvidenceBindingHash,
  BitgetDemoCertificationRunnerError,
  createBitgetDemoCertificationExecutor,
  recoverReviewedBitgetDemoDispatch,
  verifyFreshBitgetDemoControlEvidence,
  type BitgetDemoCertificationRunnerDependencies,
  type BitgetDemoCredentialProvider,
  type BitgetDemoFreshControlEvidenceInput,
  type BitgetDemoReadOnlyRecoveryReceiptBase,
} from '../src/live/adapters/bitget/demo-certification-runner.ts'
import type { ReviewedBitgetDemoDispatchOutcome } from '../src/live/adapters/bitget/demo-dispatch-orchestrator.ts'
import {
  buildBitgetPlaceOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const NOW = Date.parse('2026-07-18T03:00:30.000Z')
const RELOADED_AT = '2026-07-18T03:00:29.500Z'
const FIXTURE_SIGNING_MATERIAL: Readonly<BitgetDemoSigningMaterial> = Object.freeze({
  apiKey: 'fixture-only-access-id',
  secretKey: 'fixture-only-signing-key',
  passphrase: 'fixture-only-passphrase',
})

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
    clientOrderId: 'demo-runner-place-0001',
    previewHash: '1'.repeat(64),
    force: 'gtc',
    builtAt: '2026-07-18T03:00:00.000Z',
    expiresAt: '2026-07-18T03:02:00.000Z',
  })
}

function capabilityLocks() {
  return {
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  }
}

function freshEvidence(current: BitgetUnsignedMutationCandidate): BitgetDemoFreshControlEvidenceInput {
  const common = {
    schemaVersion: 1 as const,
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: 'bitget-demo-account-0001',
    candidateHash: current.candidateHash,
    operation: current.operation,
    productSymbol: 'BTCUSDT',
    reloadedAt: RELOADED_AT,
    ...capabilityLocks(),
  }
  return Object.freeze({
    guardian: Object.freeze({
      ...common,
      evidenceType: 'GUARDIAN' as const,
      status: 'CLEAR' as const,
      actionAllowed: true as const,
      stateVersionHash: '2'.repeat(64),
    }),
    risk: Object.freeze({
      ...common,
      evidenceType: 'RISK' as const,
      decisionId: 'demo-risk-decision-0001',
      configurationVersion: 'demo-risk-v1',
      approved: true as const,
    }),
    idempotency: Object.freeze({
      ...common,
      evidenceType: 'IDEMPOTENCY' as const,
      authorizationId: 'demo-runner-authorization-0001',
      dispatchAttemptId: 'demo-runner-attempt-0001',
      claimId: 'demo-runner-idempotency-claim-0001',
      idempotencyKeyHash: '3'.repeat(64),
      status: 'CLAIMED' as const,
    }),
  })
}

async function fixture() {
  const current = await candidate()
  const evidence = freshEvidence(current)
  const [guardianEvidenceHash, riskEvidenceHash, idempotencyEvidenceHash] = await Promise.all([
    bitgetDemoControlEvidenceBindingHash(evidence.guardian),
    bitgetDemoControlEvidenceBindingHash(evidence.risk),
    bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
  ])
  const authorization = verifyBitgetDemoDispatchAuthorization({
    authorizationId: 'demo-runner-authorization-0001',
    dispatchAttemptId: 'demo-runner-attempt-0001',
    exchangeAccountId: 'bitget-demo-account-0001',
    actorId: 'risk-approver-0001',
    preparerId: 'candidate-preparer-0001',
    candidateHash: current.candidateHash,
    authorizationEvidenceHash: '4'.repeat(64),
    stepUpEvidenceHash: '5'.repeat(64),
    riskEvidenceHash,
    guardianEvidenceHash,
    idempotencyEvidenceHash,
    validFrom: '2026-07-18T03:00:10.000Z',
    expiresAt: '2026-07-18T03:01:10.000Z',
    environment: 'BITGET_DEMO',
    accountCoordinatorSerialized: true,
    guardianClear: true,
    riskApproved: true,
    idempotencyClaimed: true,
    demoMutationReviewed: true,
    liveReleasePresent: false,
    ...capabilityLocks(),
  })
  return { current, evidence, authorization }
}

function credentialProvider(events: string[]): BitgetDemoCredentialProvider {
  return {
    async withDemoSigningMaterial<T>(request, use): Promise<T> {
      events.push('credential-callback')
      assert.equal(request.environment, 'BITGET_DEMO')
      assert.equal(request.liveExecutionAllowed, false)
      assert.equal(request.realFundsAllowed, false)
      assert.equal(request.mainnetAllowed, false)
      assert.equal(request.withdrawalsAllowed, false)
      assert.equal(request.automaticRetryAllowed, false)
      return use(FIXTURE_SIGNING_MATERIAL)
    },
  }
}

function dependencies(input: {
  evidence: BitgetDemoFreshControlEvidenceInput
  events: string[]
  fetcher: typeof fetch
  credentialProvider?: BitgetDemoCredentialProvider
}): BitgetDemoCertificationRunnerDependencies {
  return {
    serializer: {
      async run<T>(_accountId: string, operation: () => Promise<T>): Promise<T> {
        input.events.push('serialized')
        return operation()
      },
    },
    freshControlEvidenceLoader: {
      async load() {
        input.events.push('fresh-control')
        return input.evidence
      },
    },
    credentialProvider: input.credentialProvider ?? credentialProvider(input.events),
    rateLimitAuthorityProvider: {
      async forAccount(accountId) {
        input.events.push('rate-authority')
        assert.equal(accountId, 'bitget-demo-account-0001')
        return {
          async claim(request: Readonly<BitgetDemoRateLimitClaimInput>) {
            input.events.push('rate-claim')
            return Object.freeze({
              allowed: true,
              exchangeAccountId: request.exchangeAccountId,
              dispatchAttemptId: request.dispatchAttemptId,
              candidateHash: request.candidateHash,
              operation: request.operation,
              claimedAtMs: request.requestedAtMs,
              windowMs: request.windowMs,
              maximumRequests: request.maximumRequests,
              receiptHash: '6'.repeat(64),
            })
          },
        }
      },
    },
    recoveryBoundary: {
      async recover() {
        throw new Error('recovery is not expected in executor-only tests')
      },
    },
    fetcher: input.fetcher,
    clock: Object.freeze({ now: () => new Date(NOW) }),
  }
}

function certificationExecutor(input: {
  evidence: BitgetDemoFreshControlEvidenceInput
  events: string[]
  fetcher: typeof fetch
  credentialProvider?: BitgetDemoCredentialProvider
}) {
  return createBitgetDemoCertificationExecutor(
    dependencies(input),
    Object.freeze({
      async record({ candidate, authorization, verified }) {
        input.events.push('control-persistence')
        return Object.freeze({
          projectionStatus: 'PROJECTED' as const,
          dispatchAttemptId: authorization.dispatchAttemptId,
          authorizationId: authorization.authorizationId,
          candidateHash: candidate.candidateHash,
          claimHash: '9'.repeat(64),
          verificationHash: 'a'.repeat(64),
          verifiedAt: verified.verifiedAt,
          providerMutationAllowed: false as const,
          executionAllowed: false as const,
          liveExecutionAllowed: false as const,
          realFundsAllowed: false as const,
          mainnetAllowed: false as const,
          withdrawalsAllowed: false as const,
          automaticRetryAllowed: false as const,
        })
      },
    }),
  )
}

test('fresh Guardian, risk, and idempotency evidence receives a non-enumerable in-memory brand', async () => {
  const { current, evidence, authorization } = await fixture()
  const verified = await verifyFreshBitgetDemoControlEvidence(
    evidence,
    current,
    authorization,
    new Date(NOW).toISOString(),
  )
  assertFreshBitgetDemoControlEvidenceVerified(verified)
  assert.equal(verified.guardianClear, true)
  assert.equal(verified.riskApproved, true)
  assert.equal(verified.idempotencyClaimed, true)
  assert.equal(
    await bitgetDemoControlEvidenceBindingHash({
      ...evidence.guardian,
      reloadedAt: '2026-07-18T03:00:29.000Z',
    }),
    authorization.guardianEvidenceHash,
  )
  assert.deepEqual(Object.getOwnPropertySymbols(verified), [
    Object.getOwnPropertySymbols(verified)[0],
  ])
  assert.equal(Object.getOwnPropertyDescriptor(
    verified,
    Object.getOwnPropertySymbols(verified)[0]!,
  )?.enumerable, false)
  assert.throws(
    () => assertFreshBitgetDemoControlEvidenceVerified({ ...verified }),
    /freshly reloaded and in-memory verified control evidence/,
  )
  assert.throws(
    () => assertFreshBitgetDemoControlEvidenceVerified(
      JSON.parse(JSON.stringify(verified)) as typeof verified,
    ),
    /freshly reloaded and in-memory verified control evidence/,
  )
})

test('certification executor reloads controls before callback-scoped credentials and demo transport', async () => {
  const { current, evidence, authorization } = await fixture()
  const events: string[] = []
  const executor = certificationExecutor({
    evidence,
    events,
    fetcher: async (url, init) => {
      events.push('fetch')
      assert.equal(url, 'https://api.bitget.com/api/v2/spot/trade/place-order')
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('paptrading'), '1')
      assert.equal(headers.get('ACCESS-KEY'), FIXTURE_SIGNING_MATERIAL.apiKey)
      return new Response(JSON.stringify({
        code: '00000',
        msg: 'success',
        data: {
          orderId: 'demo-provider-order-0001',
          clientOid: 'demo-runner-place-0001',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })

  const result = await executor.dispatch(current, authorization)
  assert.deepEqual(events, [
    'fresh-control',
    'control-persistence',
    'rate-authority',
    'credential-callback',
    'rate-claim',
    'fetch',
  ])
  assert.equal(result.category, 'ACKNOWLEDGED')
  assert.equal(result.providerAcknowledgmentVerified, true)
  assert.equal(result.liveExecutionAllowed, false)
  assert.equal(result.realFundsAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
})

test('stale or changed control evidence fails before credentials, rate claim, and fetch', async () => {
  const { current, evidence, authorization } = await fixture()
  const events: string[] = []
  const stale: BitgetDemoFreshControlEvidenceInput = {
    ...evidence,
    guardian: {
      ...evidence.guardian,
      reloadedAt: '2026-07-18T03:00:20.000Z',
    },
  }
  const executor = certificationExecutor({
    evidence: stale,
    events,
    fetcher: async () => {
      events.push('fetch')
      throw new Error('fetch must not run')
    },
  })
  await assert.rejects(
    executor.dispatch(current, authorization),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationRunnerError
      && error.code === 'CONTROL_EVIDENCE_STALE_OR_MISMATCHED'
    ),
  )
  assert.deepEqual(events, ['fresh-control'])
})

test('fresh-control evidence persistence must succeed before credentials, rate authority, or fetch', async () => {
  const { current, evidence, authorization } = await fixture()
  const events: string[] = []
  const executor = createBitgetDemoCertificationExecutor(
    dependencies({
      evidence,
      events,
      fetcher: async () => {
        events.push('fetch')
        throw new Error('fetch must not run')
      },
    }),
    {
      async record() {
        events.push('control-persistence')
        throw new Error('immutable control evidence unavailable')
      },
    },
  )
  await assert.rejects(
    executor.dispatch(current, authorization),
    /immutable control evidence unavailable/,
  )
  assert.deepEqual(events, ['fresh-control', 'control-persistence'])
})

test('credential provider must execute its signing-material callback exactly once while active', async () => {
  const { current, evidence, authorization } = await fixture()
  const events: string[] = []
  let deferredUse: ((material: Readonly<BitgetDemoSigningMaterial>) => Promise<unknown>) | null = null
  const unusedProvider: BitgetDemoCredentialProvider = {
    async withDemoSigningMaterial<T>(_request, use): Promise<T> {
      events.push('credential-callback-skipped')
      deferredUse = use as (material: Readonly<BitgetDemoSigningMaterial>) => Promise<unknown>
      return Object.freeze({}) as T
    },
  }
  const executor = certificationExecutor({
    evidence,
    events,
    credentialProvider: unusedProvider,
    fetcher: async () => {
      events.push('fetch')
      throw new Error('fetch must not run')
    },
  })
  await assert.rejects(
    executor.dispatch(current, authorization),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationRunnerError
      && error.code === 'CREDENTIAL_LEASE_UNUSED'
    ),
  )
  assert.equal(events.includes('fetch'), false)
  assert.ok(deferredUse)
  await assert.rejects(
    deferredUse(FIXTURE_SIGNING_MATERIAL),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationRunnerError
      && error.code === 'CREDENTIAL_LEASE_REUSED'
    ),
  )
  assert.equal(events.includes('fetch'), false)
})

function reviewedOutcome(input: {
  result: BitgetDemoDispatchResult
  resultHash: string
}): ReviewedBitgetDemoDispatchOutcome {
  return {
    reviewedAuthorization: {} as ReviewedBitgetDemoDispatchOutcome['reviewedAuthorization'],
    claim: {} as ReviewedBitgetDemoDispatchOutcome['claim'],
    result: input.result,
    persistence: {
      projectionStatus: 'PROJECTED',
      dispatchAttemptId: input.result.dispatchAttemptId,
      authorizationId: input.result.authorizationId,
      candidateHash: input.result.candidateHash,
      resultHash: input.resultHash,
      category: input.result.category,
      recoveryLookupCount: input.result.recoveryLookups.length,
      demoRequestSent: input.result.demoRequestSent,
      requiresReadOnlyRecovery: input.result.requiresReadOnlyRecovery,
      realProviderMutationAllowed: false,
      liveExecutionAllowed: false,
      realFundsAllowed: false,
      mainnetAllowed: false,
      withdrawalsAllowed: false,
      automaticallyRetried: false,
    },
  }
}

test('ambiguous result invokes one hash-bound read-only recovery without retry or accounting dispatch', async () => {
  const { current, evidence, authorization } = await fixture()
  const events: string[] = []
  const executor = certificationExecutor({
    evidence,
    events,
    fetcher: async () => new Response(JSON.stringify({
      code: '50000',
      msg: 'provider unavailable',
      data: {},
    }), { status: 503, headers: { 'content-type': 'application/json' } }),
  })
  const result = await executor.dispatch(current, authorization)
  assert.equal(result.requiresReadOnlyRecovery, true)
  const resultHash = await canonicalHash(result)
  let recoveryCalls = 0
  const receipt = await recoverReviewedBitgetDemoDispatch(
    reviewedOutcome({ result, resultHash }),
    {
      async recover(input) {
        recoveryCalls += 1
        const base: BitgetDemoReadOnlyRecoveryReceiptBase = Object.freeze({
          schemaVersion: 1,
          recoveryId: 'demo-runner-recovery-0001',
          dispatchAttemptId: input.result.dispatchAttemptId,
          authorizationId: input.result.authorizationId,
          exchangeAccountId: input.result.exchangeAccountId,
          candidateHash: input.result.candidateHash,
          resultHash: input.resultHash,
          lookupPlanHash: input.lookupPlanHash,
          lookupCount: input.lookups.length,
          status: 'RECOVERED',
          snapshotHash: '7'.repeat(64),
          observedAt: new Date(NOW).toISOString(),
          readOnly: true,
          providerMutationAllowed: false,
          executionAllowed: false,
          accountingAutomaticallyDispatched: false,
          ...capabilityLocks(),
        })
        return Object.freeze({ ...base, receiptHash: await canonicalHash(base) })
      },
    },
    Object.freeze({ now: () => new Date(NOW) }),
  )
  assert.equal(recoveryCalls, 1)
  assert.equal(receipt?.status, 'RECOVERED')
  assert.equal(receipt?.readOnly, true)
  assert.equal(receipt?.accountingAutomaticallyDispatched, false)
  assert.equal(receipt?.automaticRetryAllowed, false)
})

test('acknowledged result does not call recovery and a forged recovery receipt fails closed', async () => {
  const { current, evidence, authorization } = await fixture()
  const events: string[] = []
  const executor = certificationExecutor({
    evidence,
    events,
    fetcher: async () => new Response(JSON.stringify({
      code: '00000',
      msg: 'success',
      data: { orderId: 'demo-provider-order-0002', clientOid: 'demo-runner-place-0001' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  const acknowledged = await executor.dispatch(current, authorization)
  const acknowledgedHash = await canonicalHash(acknowledged)
  let calls = 0
  const noRecovery = await recoverReviewedBitgetDemoDispatch(
    reviewedOutcome({ result: acknowledged, resultHash: acknowledgedHash }),
    { async recover() { calls += 1; throw new Error('must not run') } },
    Object.freeze({ now: () => new Date(NOW) }),
  )
  assert.equal(noRecovery, null)
  assert.equal(calls, 0)

  const ambiguous: BitgetDemoDispatchResult = Object.freeze({
    ...acknowledged,
    category: 'AMBIGUOUS_REQUIRES_LOOKUP',
    reason: 'provider_result_is_ambiguous',
    recoveryLookups: current.recoveryLookups,
    requiresReadOnlyRecovery: true,
    providerAcknowledgmentVerified: false,
  })
  const ambiguousHash = await canonicalHash(ambiguous)
  await assert.rejects(
    recoverReviewedBitgetDemoDispatch(
      reviewedOutcome({ result: ambiguous, resultHash: ambiguousHash }),
      {
        async recover(input) {
          const base: BitgetDemoReadOnlyRecoveryReceiptBase = {
            schemaVersion: 1,
            recoveryId: 'demo-runner-recovery-forged',
            dispatchAttemptId: input.result.dispatchAttemptId,
            authorizationId: input.result.authorizationId,
            exchangeAccountId: input.result.exchangeAccountId,
            candidateHash: input.result.candidateHash,
            resultHash: input.resultHash,
            lookupPlanHash: input.lookupPlanHash,
            lookupCount: input.lookups.length,
            status: 'INCOMPLETE',
            snapshotHash: null,
            observedAt: new Date(NOW).toISOString(),
            readOnly: true,
            providerMutationAllowed: false,
            executionAllowed: false,
            accountingAutomaticallyDispatched: false,
            ...capabilityLocks(),
          }
          return { ...base, receiptHash: '8'.repeat(64) }
        },
      },
      Object.freeze({ now: () => new Date(NOW) }),
    ),
    (error: unknown) => (
      error instanceof BitgetDemoCertificationRunnerError
      && error.code === 'RECOVERY_RECEIPT_HASH_MISMATCH'
    ),
  )
})
