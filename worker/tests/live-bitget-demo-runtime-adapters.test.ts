import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash } from '../src/live/canonical-json.ts'
import {
  bitgetDemoControlEvidenceBindingHash,
  type BitgetDemoFreshControlEvidenceInput,
} from '../src/live/adapters/bitget/demo-certification-runner.ts'
import {
  createBitgetDemoCallbackCredentialProvider,
  createBitgetDemoDurableRateLimitAuthorityProvider,
  createBitgetDemoGetOnlyRecoveryBoundary,
  createVerifiedBitgetDemoFreshControlLoader,
  type BitgetDemoRateLimitNamespace,
} from '../src/live/adapters/bitget/demo-runtime-adapters.ts'
import {
  verifyBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchResult,
  type BitgetDemoRateLimitClaimInput,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  buildBitgetCancelOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const BUILT_AT = '2026-07-19T10:00:00.000Z'
const EVALUATED_AT = '2026-07-19T10:00:30.000Z'
const RELOADED_AT = '2026-07-19T10:00:29.500Z'
const EXPIRES_AT = '2026-07-19T10:02:00.000Z'

function locks() {
  return {
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  }
}

async function fixture(): Promise<{
  candidate: BitgetUnsignedMutationCandidate
  evidence: BitgetDemoFreshControlEvidenceInput
  authorization: ReturnType<typeof verifyBitgetDemoDispatchAuthorization>
}> {
  const candidate = await buildBitgetCancelOrderCandidate({
    productId: 'BTC-USDT',
    identity: { orderId: 'demo-order-0001', clientOrderId: null },
    builtAt: BUILT_AT,
    expiresAt: EXPIRES_AT,
  })
  const common = {
    schemaVersion: 1 as const,
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: 'bitget-demo-account-0001',
    candidateHash: candidate.candidateHash,
    operation: candidate.operation,
    productSymbol: 'BTCUSDT',
    reloadedAt: RELOADED_AT,
    ...locks(),
  }
  const evidence = Object.freeze({
    guardian: Object.freeze({
      ...common,
      evidenceType: 'GUARDIAN' as const,
      status: 'CLEAR' as const,
      actionAllowed: true as const,
      stateVersionHash: '1'.repeat(64),
    }),
    risk: Object.freeze({
      ...common,
      evidenceType: 'RISK' as const,
      decisionId: 'risk-decision-0001',
      configurationVersion: 'risk-v1',
      approved: true as const,
    }),
    idempotency: Object.freeze({
      ...common,
      evidenceType: 'IDEMPOTENCY' as const,
      authorizationId: 'demo-authorization-0001',
      dispatchAttemptId: 'demo-attempt-0001',
      claimId: 'idempotency-claim-0001',
      idempotencyKeyHash: '2'.repeat(64),
      status: 'CLAIMED' as const,
    }),
  })
  const [guardianEvidenceHash, riskEvidenceHash, idempotencyEvidenceHash] = await Promise.all([
    bitgetDemoControlEvidenceBindingHash(evidence.guardian),
    bitgetDemoControlEvidenceBindingHash(evidence.risk),
    bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
  ])
  const authorization = verifyBitgetDemoDispatchAuthorization({
    authorizationId: 'demo-authorization-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    exchangeAccountId: 'bitget-demo-account-0001',
    actorId: 'risk-approver-0001',
    preparerId: 'candidate-preparer-0001',
    candidateHash: candidate.candidateHash,
    authorizationEvidenceHash: '3'.repeat(64),
    stepUpEvidenceHash: '4'.repeat(64),
    riskEvidenceHash,
    guardianEvidenceHash,
    idempotencyEvidenceHash,
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
  return { candidate, evidence, authorization }
}

test('callback credential adapter leases frozen demo material exactly once', async () => {
  const events: string[] = []
  const provider = createBitgetDemoCallbackCredentialProvider({
    async withLease(accountId, use) {
      events.push(`lease:${accountId}`)
      return use(Object.freeze({ apiKey: 'demo-key', secretKey: 'demo-secret', passphrase: 'demo-pass' }))
    },
  })
  const result = await provider.withDemoSigningMaterial({
    environment: 'BITGET_DEMO',
    exchangeAccountId: 'bitget-demo-account-0001',
    candidateHash: '5'.repeat(64),
    authorizationId: 'demo-authorization-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    ...locks(),
  }, async (material) => {
    events.push('callback')
    assert.equal(Object.isFrozen(material), true)
    assert.equal(material.apiKey, 'demo-key')
    return 'used'
  })
  assert.equal(result, 'used')
  assert.deepEqual(events, ['lease:bitget-demo-account-0001', 'callback'])
})

test('credential adapter rejects a lease source that never invokes its callback', async () => {
  const provider = createBitgetDemoCallbackCredentialProvider({
    async withLease<T>() {
      return 'unused' as T
    },
  })
  await assert.rejects(
    () => provider.withDemoSigningMaterial({
      environment: 'BITGET_DEMO',
      exchangeAccountId: 'bitget-demo-account-0001',
      candidateHash: '5'.repeat(64),
      authorizationId: 'demo-authorization-0001',
      dispatchAttemptId: 'demo-attempt-0001',
      ...locks(),
    }, async () => 'used'),
    /must invoke its callback once/,
  )
})

test('Durable Object rate provider scopes a Request-based claim to one account', async () => {
  let requestedName = ''
  let requestBody: BitgetDemoRateLimitClaimInput | null = null
  const namespace: BitgetDemoRateLimitNamespace<string> = {
    idFromName(name) {
      requestedName = name
      return name
    },
    get() {
      return {
        async fetch(request: Request) {
          requestBody = await request.json() as BitgetDemoRateLimitClaimInput
          return new Response(JSON.stringify({
            allowed: true,
            exchangeAccountId: requestBody.exchangeAccountId,
            dispatchAttemptId: requestBody.dispatchAttemptId,
            candidateHash: requestBody.candidateHash,
            operation: requestBody.operation,
            claimedAtMs: requestBody.requestedAtMs,
            windowMs: requestBody.windowMs,
            maximumRequests: requestBody.maximumRequests,
            receiptHash: '6'.repeat(64),
          }), { status: 200 })
        },
      }
    },
  }
  const provider = createBitgetDemoDurableRateLimitAuthorityProvider(namespace)
  const authority = await provider.forAccount('bitget-demo-account-0001')
  const claim = await authority.claim({
    exchangeAccountId: 'bitget-demo-account-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    candidateHash: '7'.repeat(64),
    operation: 'PLACE',
    endpoint: '/api/v2/spot/trade/place-order',
    requestedAtMs: 1784455230000,
    windowMs: 1000,
    maximumRequests: 10,
  })
  assert.equal(requestedName, 'bitget-demo-rate:bitget-demo-account-0001')
  assert.equal(requestBody?.exchangeAccountId, 'bitget-demo-account-0001')
  assert.equal(claim.allowed, true)
  assert.equal(claim.receiptHash, '6'.repeat(64))
})

test('fresh-control adapter revalidates evidence hashes before returning it', async () => {
  const { candidate, evidence, authorization } = await fixture()
  const loader = createVerifiedBitgetDemoFreshControlLoader({ async reload() { return evidence } })
  assert.equal((await loader.load({ candidate, authorization, evaluatedAt: EVALUATED_AT })).risk.approved, true)

  const mismatched = createVerifiedBitgetDemoFreshControlLoader({
    async reload() {
      return Object.freeze({
        ...evidence,
        guardian: Object.freeze({ ...evidence.guardian, stateVersionHash: '9'.repeat(64) }),
      })
    },
  })
  await assert.rejects(
    () => mismatched.load({ candidate, authorization, evaluatedAt: EVALUATED_AT }),
    /fresh control evidence no longer matches/,
  )
})

function ambiguousResult(candidate: BitgetUnsignedMutationCandidate): BitgetDemoDispatchResult {
  return Object.freeze({
    environment: 'BITGET_DEMO',
    dispatchAttemptId: 'demo-attempt-0001',
    authorizationId: 'demo-authorization-0001',
    exchangeAccountId: 'bitget-demo-account-0001',
    candidateHash: candidate.candidateHash,
    operation: candidate.operation,
    endpoint: candidate.endpoint,
    category: 'AMBIGUOUS_REQUIRES_LOOKUP',
    reason: 'timeout',
    requestBodyHash: 'a'.repeat(64),
    rateLimitReceiptHash: 'b'.repeat(64),
    httpStatus: null,
    providerCode: null,
    providerMessage: null,
    acknowledgedOrderId: null,
    acknowledgedClientOrderId: null,
    recoveryLookups: candidate.recoveryLookups,
    demoRequestSent: true,
    demoProviderMutationAttempted: true,
    requiresReadOnlyRecovery: true,
    providerAcknowledgmentVerified: false,
    realProviderMutationAllowed: false,
    ...locks(),
  })
}

test('GET-only recovery creates deterministic recovered evidence for a matching identity', async () => {
  const { candidate } = await fixture()
  const result = ambiguousResult(candidate)
  const boundary = createBitgetDemoGetOnlyRecoveryBoundary({
    async lookup(instruction) {
      return Object.freeze({
        status: 'FOUND' as const,
        observedAt: '2026-07-19T10:00:31.000Z',
        orderId: instruction.query.orderId ?? null,
        clientOrderId: instruction.query.clientOid ?? null,
        payloadHash: 'c'.repeat(64),
        providerMutationAllowed: false as const,
        executionAllowed: false as const,
        readOnly: true as const,
        ...locks(),
      })
    },
  })
  const receipt = await boundary.recover({
    result,
    resultHash: await canonicalHash(result),
    lookups: candidate.recoveryLookups,
    lookupPlanHash: await canonicalHash(candidate.recoveryLookups),
    requestedAt: EVALUATED_AT,
  })
  assert.equal(receipt.status, 'RECOVERED')
  assert.match(receipt.snapshotHash ?? '', /^[a-f0-9]{64}$/)
  assert.equal(receipt.accountingAutomaticallyDispatched, false)
  assert.equal(receipt.automaticRetryAllowed, false)
})

test('GET-only recovery remains incomplete when the provider identity is absent', async () => {
  const { candidate } = await fixture()
  const result = ambiguousResult(candidate)
  const boundary = createBitgetDemoGetOnlyRecoveryBoundary({
    async lookup() {
      return Object.freeze({
        status: 'NOT_FOUND' as const,
        observedAt: '2026-07-19T10:00:31.000Z',
        orderId: null,
        clientOrderId: null,
        payloadHash: null,
        providerMutationAllowed: false as const,
        executionAllowed: false as const,
        readOnly: true as const,
        ...locks(),
      })
    },
  })
  const receipt = await boundary.recover({
    result,
    resultHash: await canonicalHash(result),
    lookups: candidate.recoveryLookups,
    lookupPlanHash: await canonicalHash(candidate.recoveryLookups),
    requestedAt: EVALUATED_AT,
  })
  assert.equal(receipt.status, 'INCOMPLETE')
  assert.equal(receipt.snapshotHash, null)
  assert.equal(receipt.providerMutationAllowed, false)
})
