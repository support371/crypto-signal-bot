import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalJson } from '../src/live/canonical-json.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import {
  BITGET_DEMO_WRITE_CONTRACT,
  BitgetDemoWriteTransport,
  type BitgetDemoDispatchAuthorizationInput,
  type BitgetDemoRateLimitAuthority,
  type BitgetDemoRateLimitClaimInput,
  type BitgetDemoSigningMaterial,
  verifyBitgetDemoDispatchAuthorization,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  buildBitgetCancelOrderCandidate,
  buildBitgetCancelReplaceOrderCandidate,
  buildBitgetPlaceOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const NOW = Date.parse('2026-07-18T01:00:30.000Z')
const HASHES = Object.freeze({
  authorization: '1'.repeat(64),
  stepUp: '2'.repeat(64),
  risk: '3'.repeat(64),
  guardian: '4'.repeat(64),
  idempotency: '5'.repeat(64),
  preview: '6'.repeat(64),
  rateLimit: '7'.repeat(64),
})
const SIGNING_MATERIAL: BitgetDemoSigningMaterial = Object.freeze({
  apiKey: 'TEST_ONLY_NOT_A_REAL_API_KEY',
  secretKey: 'TEST_ONLY_NOT_A_REAL_SECRET',
  passphrase: 'TEST_ONLY_NOT_A_REAL_PASSPHRASE',
})
const SIGNED_BODY_FIXTURES = Object.freeze({
  place: Object.freeze({
    body: '{"clientOid":"demo-place-0001","force":"gtc","orderType":"market","side":"buy","size":"100","symbol":"BTCUSDT"}',
    signature: 'p7l1AYheofyaNaZklxeI7n3kZpxlWX4dmD/H/Pvsu+k=',
  }),
  cancel: Object.freeze({
    body: '{"clientOid":"demo-place-0001","symbol":"BTCUSDT"}',
    signature: 'zejiUmL0GwYUaolLv3VVA13KG8AmPIaw2A7ZuDmx+rI=',
  }),
  cancelReplace: Object.freeze({
    body: '{"newClientOid":"demo-replace-0001","orderId":"provider-order-0001","price":"50000","size":"0.002","symbol":"BTCUSDT"}',
    signature: '11BbkKkwIfWuPI0MPRiEULLbMgWgjxT89gLvUgk7Ne4=',
  }),
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
    observedAt: '2026-07-18T00:59:00.000Z',
    expiresAt: '2026-07-18T01:02:00.000Z',
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
    clientOrderId: 'demo-place-0001',
    previewHash: HASHES.preview,
    force: 'gtc',
    builtAt: '2026-07-18T01:00:00.000Z',
    expiresAt: '2026-07-18T01:02:00.000Z',
  })
}

async function cancelCandidate(): Promise<BitgetUnsignedMutationCandidate> {
  return buildBitgetCancelOrderCandidate({
    productId: 'BTC-USDT',
    identity: { orderId: null, clientOrderId: 'demo-place-0001' },
    builtAt: '2026-07-18T01:00:00.000Z',
    expiresAt: '2026-07-18T01:02:00.000Z',
  })
}

async function cancelReplaceCandidate(): Promise<BitgetUnsignedMutationCandidate> {
  return buildBitgetCancelReplaceOrderCandidate({
    productId: 'BTC-USDT',
    oldIdentity: { orderId: 'provider-order-0001', clientOrderId: null },
    replacement: {
      request: {
        productId: 'BTC-USDT',
        side: 'BUY',
        orderType: 'LIMIT',
        baseQuantity: asDecimalString('0.002'),
        quoteNotional: null,
        limitPrice: asDecimalString('50000'),
        stopPrice: null,
      },
      productRules: productRules(),
      clientOrderId: 'demo-replace-0001',
      previewHash: HASHES.preview,
      force: 'gtc',
      builtAt: '2026-07-18T01:00:00.000Z',
      expiresAt: '2026-07-18T01:02:00.000Z',
    },
    builtAt: '2026-07-18T01:00:00.000Z',
    expiresAt: '2026-07-18T01:02:00.000Z',
  })
}

function authorizationInput(
  candidate: BitgetUnsignedMutationCandidate,
  overrides: Partial<BitgetDemoDispatchAuthorizationInput> = {},
): BitgetDemoDispatchAuthorizationInput {
  return {
    authorizationId: 'demo-authorization-0001',
    dispatchAttemptId: 'demo-attempt-0001',
    exchangeAccountId: 'bitget-demo-account-0001',
    actorId: 'risk-approver-0001',
    preparerId: 'plan-preparer-0001',
    candidateHash: candidate.candidateHash,
    authorizationEvidenceHash: HASHES.authorization,
    stepUpEvidenceHash: HASHES.stepUp,
    riskEvidenceHash: HASHES.risk,
    guardianEvidenceHash: HASHES.guardian,
    idempotencyEvidenceHash: HASHES.idempotency,
    validFrom: '2026-07-18T01:00:10.000Z',
    expiresAt: '2026-07-18T01:01:10.000Z',
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

function rateLimitAuthority(
  claims: BitgetDemoRateLimitClaimInput[],
  allowed = true,
): BitgetDemoRateLimitAuthority {
  return {
    async claim(input) {
      claims.push(input)
      return {
        allowed,
        exchangeAccountId: input.exchangeAccountId,
        dispatchAttemptId: input.dispatchAttemptId,
        candidateHash: input.candidateHash,
        operation: input.operation,
        claimedAtMs: input.requestedAtMs,
        windowMs: input.windowMs,
        maximumRequests: input.maximumRequests,
        receiptHash: HASHES.rateLimit,
      }
    },
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

test('demo place request uses exact body, official headers, and HMAC fixture without exposing credentials', async () => {
  const candidate = await placeCandidate()
  const authorization = verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate))
  const claims: BitgetDemoRateLimitClaimInput[] = []
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedInit = init
    return jsonResponse({
      code: '00000',
      msg: 'success',
      data: { orderId: 'provider-order-0001', clientOid: 'demo-place-0001' },
    })
  }
  const transport = new BitgetDemoWriteTransport({
    fetcher,
    rateLimitAuthority: rateLimitAuthority(claims),
    now: () => NOW,
  })

  const result = await transport.dispatch(candidate, authorization, SIGNING_MATERIAL)

  assert.equal(capturedUrl, 'https://api.bitget.com/api/v2/spot/trade/place-order')
  assert.equal(capturedInit?.method, 'POST')
  assert.equal(capturedInit?.redirect, 'error')
  assert.equal(capturedInit?.body, SIGNED_BODY_FIXTURES.place.body)
  assert.equal(canonicalJson(candidate.unsignedBody), SIGNED_BODY_FIXTURES.place.body)
  assert.equal(candidate.unsignedBody.size, '100')
  const headers = new Headers(capturedInit?.headers)
  assert.equal(headers.get('paptrading'), '1')
  assert.equal(headers.get('ACCESS-KEY'), SIGNING_MATERIAL.apiKey)
  assert.equal(headers.get('ACCESS-TIMESTAMP'), String(NOW))
  assert.equal(headers.get('ACCESS-PASSPHRASE'), SIGNING_MATERIAL.passphrase)
  assert.equal(headers.get('ACCESS-SIGN'), SIGNED_BODY_FIXTURES.place.signature)
  assert.equal(claims.length, 1)
  assert.equal(claims[0]?.maximumRequests, 10)
  assert.equal(result.category, 'ACKNOWLEDGED')
  assert.equal(result.providerAcknowledgmentVerified, true)
  assert.equal(result.demoRequestSent, true)
  assert.equal(result.realProviderMutationAllowed, false)
  assert.equal(result.liveExecutionAllowed, false)
  assert.equal(result.realFundsAllowed, false)
  assert.equal(result.mainnetAllowed, false)
  assert.equal(result.withdrawalsAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
  const serializedResult = JSON.stringify(result)
  assert.equal(serializedResult.includes(SIGNING_MATERIAL.apiKey), false)
  assert.equal(serializedResult.includes(SIGNING_MATERIAL.secretKey), false)
  assert.equal(serializedResult.includes(SIGNING_MATERIAL.passphrase), false)
})

test('fixed cancel and cancel-replace signed-body fixtures match exact documented request shapes', async () => {
  const fixtures = [
    {
      candidate: await cancelCandidate(),
      expected: SIGNED_BODY_FIXTURES.cancel,
      response: { code: '00000', data: { clientOid: 'demo-place-0001' } },
    },
    {
      candidate: await cancelReplaceCandidate(),
      expected: SIGNED_BODY_FIXTURES.cancelReplace,
      response: { code: '00000', data: { orderId: 'provider-order-0002', clientOid: 'demo-replace-0001' } },
    },
  ]
  for (const [index, fixture] of fixtures.entries()) {
    let capturedInit: RequestInit | undefined
    const transport = new BitgetDemoWriteTransport({
      fetcher: async (_input, init) => {
        capturedInit = init
        return jsonResponse(fixture.response)
      },
      rateLimitAuthority: rateLimitAuthority([]),
      now: () => NOW,
    })
    await transport.dispatch(
      fixture.candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(fixture.candidate, {
        authorizationId: `demo-authorization-signature-${index}`,
        dispatchAttemptId: `demo-attempt-signature-${index}`,
      })),
      SIGNING_MATERIAL,
    )
    assert.equal(capturedInit?.body, fixture.expected.body)
    assert.equal(new Headers(capturedInit?.headers).get('ACCESS-SIGN'), fixture.expected.signature)
  }
})

test('verified authorization brand is non-enumerable and is lost through spread and JSON serialization', async () => {
  const candidate = await placeCandidate()
  const authorization = verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate))
  const brandDescriptors = Object.getOwnPropertySymbols(authorization)
    .map((symbol) => Object.getOwnPropertyDescriptor(authorization, symbol))
  assert.equal(brandDescriptors.length, 1)
  assert.equal(brandDescriptors[0]?.enumerable, false)

  let fetchCount = 0
  const transport = new BitgetDemoWriteTransport({
    fetcher: async () => {
      fetchCount += 1
      return jsonResponse({ code: '00000', data: {} })
    },
    rateLimitAuthority: rateLimitAuthority([]),
    now: () => NOW,
  })
  await assert.rejects(
    transport.dispatch(candidate, { ...authorization }, SIGNING_MATERIAL),
    /in-memory verified authorization/,
  )
  await assert.rejects(
    transport.dispatch(
      candidate,
      JSON.parse(JSON.stringify(authorization)) as typeof authorization,
      SIGNING_MATERIAL,
    ),
    /in-memory verified authorization/,
  )
  assert.equal(fetchCount, 0)
})

test('demo authorization enforces separation of duties and a maximum five-minute validity window', async () => {
  const candidate = await placeCandidate()
  assert.throws(
    () => verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
      actorId: 'same-operator',
      preparerId: 'same-operator',
    })),
    /must differ from the candidate preparer/,
  )
  assert.throws(
    () => verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
      expiresAt: '2026-07-18T01:05:10.001Z',
    })),
    /at most five minutes/,
  )
})

test('candidate tampering, binding mismatch, expiry, and attempt replay fail before another request', async () => {
  const candidate = await placeCandidate()
  const claims: BitgetDemoRateLimitClaimInput[] = []
  let fetchCount = 0
  const transport = new BitgetDemoWriteTransport({
    fetcher: async () => {
      fetchCount += 1
      return jsonResponse({
        code: '00000',
        data: { orderId: 'provider-order-0001', clientOid: 'demo-place-0001' },
      })
    },
    rateLimitAuthority: rateLimitAuthority(claims),
    now: () => NOW,
  })

  const tampered = {
    ...candidate,
    unsignedBody: { ...candidate.unsignedBody, size: '999999' },
  }
  await assert.rejects(
    transport.dispatch(
      tampered,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate)),
      SIGNING_MATERIAL,
    ),
    /hash does not match/,
  )
  const differentCandidateHash = '9'.repeat(64)
  await assert.rejects(
    transport.dispatch(
      candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
        candidateHash: differentCandidateHash,
        dispatchAttemptId: 'demo-attempt-binding',
      })),
      SIGNING_MATERIAL,
    ),
    /does not bind this candidate/,
  )
  const expiredTransport = new BitgetDemoWriteTransport({
    fetcher: async () => jsonResponse({ code: '00000', data: {} }),
    rateLimitAuthority: rateLimitAuthority([]),
    now: () => Date.parse('2026-07-18T01:01:10.000Z'),
  })
  await assert.rejects(
    expiredTransport.dispatch(
      candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
        dispatchAttemptId: 'demo-attempt-expired',
      })),
      SIGNING_MATERIAL,
    ),
    /outside its validity window/,
  )

  const authorization = verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
    dispatchAttemptId: 'demo-attempt-replay',
  }))
  await transport.dispatch(candidate, authorization, SIGNING_MATERIAL)
  await assert.rejects(
    transport.dispatch(candidate, authorization, SIGNING_MATERIAL),
    /one-shot and cannot be replayed/,
  )
  assert.equal(fetchCount, 1)
  assert.equal(claims.length, 1)
})

test('account rate limiter applies official operation ceilings and denial sends no request', async () => {
  const cases = [
    { candidate: await placeCandidate(), limit: 10 },
    { candidate: await cancelCandidate(), limit: 10 },
    { candidate: await cancelReplaceCandidate(), limit: 5 },
  ]
  for (const [index, current] of cases.entries()) {
    const claims: BitgetDemoRateLimitClaimInput[] = []
    let fetchCount = 0
    const transport = new BitgetDemoWriteTransport({
      fetcher: async () => {
        fetchCount += 1
        return jsonResponse({ code: '00000', data: {} })
      },
      rateLimitAuthority: rateLimitAuthority(claims, false),
      now: () => NOW,
    })
    const authorization = verifyBitgetDemoDispatchAuthorization(authorizationInput(current.candidate, {
      authorizationId: `demo-authorization-rate-${index}`,
      dispatchAttemptId: `demo-attempt-rate-${index}`,
    }))
    const result = await transport.dispatch(current.candidate, authorization, SIGNING_MATERIAL)
    assert.equal(claims[0]?.maximumRequests, current.limit)
    assert.equal(claims[0]?.windowMs, 1000)
    assert.equal(result.category, 'RATE_LIMITED')
    assert.equal(result.demoRequestSent, false)
    assert.equal(result.automaticRetryAllowed, false)
    assert.equal(fetchCount, 0)
  }
})

test('malformed or stale rate-limit claims fail before signing or sending', async () => {
  const candidate = await placeCandidate()
  let fetchCount = 0
  const transport = new BitgetDemoWriteTransport({
    fetcher: async () => {
      fetchCount += 1
      return jsonResponse({ code: '00000', data: {} })
    },
    rateLimitAuthority: {
      async claim(input) {
        return {
          allowed: true,
          exchangeAccountId: input.exchangeAccountId,
          dispatchAttemptId: input.dispatchAttemptId,
          candidateHash: input.candidateHash,
          operation: input.operation,
          claimedAtMs: input.requestedAtMs - 1_001,
          windowMs: input.windowMs,
          maximumRequests: input.maximumRequests,
          receiptHash: HASHES.rateLimit,
        }
      },
    },
    now: () => NOW,
  })
  await assert.rejects(
    transport.dispatch(
      candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
        authorizationId: 'demo-authorization-stale-rate',
        dispatchAttemptId: 'demo-attempt-stale-rate',
      })),
      SIGNING_MATERIAL,
    ),
    /invalid claim/,
  )
  assert.equal(fetchCount, 0)
})

test('timeout, server failures, and certified ambiguous codes require read-only recovery without retry', async () => {
  const cases: Array<{ name: string; fetcher: typeof fetch; timeoutMs?: number }> = [
    {
      name: 'timeout',
      timeoutMs: 100,
      fetcher: (async () => new Promise<Response>(() => undefined)) as typeof fetch,
    },
    {
      name: 'connection',
      fetcher: (async () => { throw new Error('fixture network failure') }) as typeof fetch,
    },
    {
      name: 'server',
      fetcher: (async () => jsonResponse({ code: '50000', msg: 'server error' }, 503)) as typeof fetch,
    },
    {
      name: 'provider-code',
      fetcher: (async () => jsonResponse({ code: '40010', msg: 'request timed out' }, 400)) as typeof fetch,
    },
  ]
  for (const [index, current] of cases.entries()) {
    const candidate = await placeCandidate()
    const transport = new BitgetDemoWriteTransport({
      fetcher: current.fetcher,
      rateLimitAuthority: rateLimitAuthority([]),
      now: () => NOW,
      timeoutMs: current.timeoutMs,
    })
    const result = await transport.dispatch(
      candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
        authorizationId: `demo-authorization-ambiguous-${index}`,
        dispatchAttemptId: `demo-attempt-ambiguous-${index}`,
      })),
      SIGNING_MATERIAL,
    )
    assert.equal(result.category, 'AMBIGUOUS_REQUIRES_LOOKUP', current.name)
    assert.equal(result.requiresReadOnlyRecovery, true)
    assert.equal(result.recoveryLookups.length, 1)
    assert.equal(result.automaticRetryAllowed, false)
  }
})

test('deadline cancels a stalled response stream even when an injected fetcher ignores the signal', async () => {
  const candidate = await placeCandidate()
  const stalledStream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined)
    },
  })
  const transport = new BitgetDemoWriteTransport({
    fetcher: async () => new Response(stalledStream, { status: 200 }),
    rateLimitAuthority: rateLimitAuthority([]),
    now: () => NOW,
    timeoutMs: 100,
  })
  const result = await transport.dispatch(
    candidate,
    verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
      authorizationId: 'demo-authorization-stalled-stream',
      dispatchAttemptId: 'demo-attempt-stalled-stream',
    })),
    SIGNING_MATERIAL,
  )
  assert.equal(result.category, 'AMBIGUOUS_REQUIRES_LOOKUP')
  assert.equal(result.reason, 'demo_response_timed_out')
  assert.equal(result.requiresReadOnlyRecovery, true)
  assert.equal(result.automaticRetryAllowed, false)
})

test('provider authorization, terminal, rate-limit, and unknown codes fail closed', async () => {
  const cases = [
    { code: '40009', status: 401, category: 'AUTHORIZATION_FAILED', recovery: false },
    { code: '40017', status: 400, category: 'TERMINAL_REJECTED', recovery: false },
    { code: '42900', status: 429, category: 'RATE_LIMITED', recovery: false },
    { code: '49999', status: 400, category: 'UNKNOWN_REQUIRES_REVIEW', recovery: true },
  ] as const
  for (const [index, current] of cases.entries()) {
    const candidate = await placeCandidate()
    const transport = new BitgetDemoWriteTransport({
      fetcher: async () => jsonResponse({ code: current.code, msg: 'fixture provider result' }, current.status),
      rateLimitAuthority: rateLimitAuthority([]),
      now: () => NOW,
    })
    const result = await transport.dispatch(
      candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
        authorizationId: `demo-authorization-code-${index}`,
        dispatchAttemptId: `demo-attempt-code-${index}`,
      })),
      SIGNING_MATERIAL,
    )
    assert.equal(result.category, current.category)
    assert.equal(result.requiresReadOnlyRecovery, current.recovery)
    assert.equal(result.automaticRetryAllowed, false)
  }
})

test('cancel-replace acknowledgment always requires both old and new identity lookups', async () => {
  const candidate = await cancelReplaceCandidate()
  const transport = new BitgetDemoWriteTransport({
    fetcher: async () => jsonResponse({
      code: '00000',
      msg: 'success',
      data: { orderId: 'provider-order-0002', clientOid: 'demo-replace-0001' },
    }),
    rateLimitAuthority: rateLimitAuthority([]),
    now: () => NOW,
  })
  const result = await transport.dispatch(
    candidate,
    verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
      authorizationId: 'demo-authorization-replace',
      dispatchAttemptId: 'demo-attempt-replace',
    })),
    SIGNING_MATERIAL,
  )
  assert.equal(result.category, 'CANCEL_REPLACE_REQUIRES_LOOKUP')
  assert.equal(result.requiresReadOnlyRecovery, true)
  assert.equal(result.recoveryLookups.length, 2)
  assert.equal(result.providerAcknowledgmentVerified, false)
  assert.equal(result.automaticRetryAllowed, false)
})

test('invalid JSON and oversized responses are ambiguous after send', async () => {
  const cases: Array<{ name: string; response: Response }> = [
    { name: 'invalid-json', response: new Response('not-json', { status: 200 }) },
    {
      name: 'oversized',
      response: new Response(JSON.stringify({ code: '00000', data: {} }), {
        status: 200,
        headers: { 'content-length': '5000001' },
      }),
    },
  ]
  for (const [index, current] of cases.entries()) {
    const candidate = await placeCandidate()
    const transport = new BitgetDemoWriteTransport({
      fetcher: async () => current.response,
      rateLimitAuthority: rateLimitAuthority([]),
      now: () => NOW,
    })
    const result = await transport.dispatch(
      candidate,
      verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
        authorizationId: `demo-authorization-response-${index}`,
        dispatchAttemptId: `demo-attempt-response-${index}`,
      })),
      SIGNING_MATERIAL,
    )
    assert.equal(result.category, 'AMBIGUOUS_REQUIRES_LOOKUP', current.name)
    assert.equal(result.demoRequestSent, true)
    assert.equal(result.requiresReadOnlyRecovery, true)
  }
})

test('streaming response byte limit is enforced before buffering an unbounded body', async () => {
  const candidate = await placeCandidate()
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_025))
      controller.close()
    },
  })
  const transport = new BitgetDemoWriteTransport({
    fetcher: async () => new Response(oversizedStream, { status: 200 }),
    rateLimitAuthority: rateLimitAuthority([]),
    now: () => NOW,
    maxResponseBytes: 1_024,
  })
  const result = await transport.dispatch(
    candidate,
    verifyBitgetDemoDispatchAuthorization(authorizationInput(candidate, {
      authorizationId: 'demo-authorization-stream-limit',
      dispatchAttemptId: 'demo-attempt-stream-limit',
    })),
    SIGNING_MATERIAL,
  )
  assert.equal(result.category, 'AMBIGUOUS_REQUIRES_LOOKUP')
  assert.equal(result.reason, 'provider_response_exceeds_size_limit')
  assert.equal(result.requiresReadOnlyRecovery, true)
  assert.equal(result.automaticRetryAllowed, false)
})

test('contract permanently distinguishes demo mutation from live execution', () => {
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.requestHeaderName, 'paptrading')
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.requestHeaderValue, '1')
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.liveExecutionAllowed, false)
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.realFundsAllowed, false)
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.mainnetAllowed, false)
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.withdrawalsAllowed, false)
  assert.equal(BITGET_DEMO_WRITE_CONTRACT.automaticRetryAllowed, false)
})
