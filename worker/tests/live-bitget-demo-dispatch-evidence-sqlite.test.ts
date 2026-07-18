import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import { canonicalHash } from '../src/live/canonical-json.ts'
import {
  claimBitgetDemoReadOnlyRecoveryAttempt,
  persistBitgetDemoReadOnlyRecoveryReceipt,
  recordBitgetDemoControlVerification,
} from '../src/live/adapters/bitget/demo-certification-evidence-store.ts'
import {
  bitgetDemoControlEvidenceBindingHash,
  runReviewedBitgetDemoCertification,
  verifyFreshBitgetDemoControlEvidence,
  type BitgetDemoFreshControlEvidenceInput,
  type BitgetDemoReadOnlyRecoveryReceiptBase,
} from '../src/live/adapters/bitget/demo-certification-runner.ts'
import type {
  BitgetDemoDispatchAuthorizationInput,
  BitgetDemoDispatchResult,
  BitgetDemoRateLimitClaimInput,
  BitgetDemoSigningMaterial,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  claimReviewedBitgetDemoDispatchAttempt,
  loadReviewedBitgetDemoDispatchAuthorization,
  persistBitgetDemoDispatchResult,
  recordReviewedBitgetDemoDispatchAuthorization,
} from '../src/live/adapters/bitget/demo-dispatch-evidence-store.ts'
import {
  buildBitgetPlaceOrderCandidate,
  type BitgetUnsignedMutationCandidate,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsRoot = path.resolve(here, '..', 'migrations')
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

interface SqliteD1Statement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): SqliteD1Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

class SqliteD1 {
  readonly database = new DatabaseSync(':memory:')

  constructor() {
    this.database.exec('PRAGMA foreign_keys = ON;')
    const migrations = fs.readdirSync(migrationsRoot)
      .filter((name) => /^(?:00[3-9]|01\d|02[0-6])_.*\.sql$/.test(name))
      .sort()
    for (const migration of migrations) {
      this.database.exec(fs.readFileSync(path.join(migrationsRoot, migration), 'utf8'))
    }
  }

  prepare(sql: string): D1PreparedStatement {
    const owner = this
    const statement = (params: unknown[] = []): SqliteD1Statement => ({
      sql,
      params,
      bind: (...next: unknown[]) => statement(next),
      first: async <T>() => {
        const row = owner.database.prepare(sql).get(...params) as T | undefined
        return row ?? null
      },
      all: async <T>() => ({
        results: owner.database.prepare(sql).all(...params) as T[],
      }) as D1Result<T>,
      run: async () => {
        const result = owner.database.prepare(sql).run(...params)
        return { meta: { changes: Number(result.changes) } } as D1Result
      },
    })
    return statement() as unknown as D1PreparedStatement
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const pending = statements as unknown as SqliteD1Statement[]
    this.database.exec('BEGIN IMMEDIATE;')
    try {
      const results: D1Result[] = []
      for (const statement of pending) results.push(await statement.run())
      this.database.exec('COMMIT;')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
  }

  env() {
    return { DB: this as unknown as D1Database }
  }

  close(): void {
    this.database.close()
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
    observedAt: '2026-07-18T03:59:00.000Z',
    expiresAt: '2026-07-18T04:02:00.000Z',
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
    clientOrderId: 'demo-sqlite-place-0001',
    previewHash: HASHES.preview,
    force: 'gtc',
    builtAt: '2026-07-18T04:00:00.000Z',
    expiresAt: '2026-07-18T04:02:00.000Z',
  })
}

function authorization(
  current: BitgetUnsignedMutationCandidate,
  overrides: Partial<BitgetDemoDispatchAuthorizationInput> = {},
): BitgetDemoDispatchAuthorizationInput {
  return {
    authorizationId: 'demo-sqlite-authorization-0001',
    dispatchAttemptId: 'demo-sqlite-attempt-0001',
    exchangeAccountId: 'bitget-demo-sqlite-account-0001',
    actorId: 'demo-sqlite-risk-approver',
    preparerId: 'demo-sqlite-preparer',
    candidateHash: current.candidateHash,
    authorizationEvidenceHash: HASHES.authorization,
    stepUpEvidenceHash: HASHES.stepUp,
    riskEvidenceHash: HASHES.risk,
    guardianEvidenceHash: HASHES.guardian,
    idempotencyEvidenceHash: HASHES.idempotency,
    validFrom: '2026-07-18T04:00:10.000Z',
    expiresAt: '2026-07-18T04:01:10.000Z',
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

function freshEvidence(current: BitgetUnsignedMutationCandidate): BitgetDemoFreshControlEvidenceInput {
  const common = {
    schemaVersion: 1 as const,
    environment: 'BITGET_DEMO' as const,
    exchangeAccountId: 'bitget-demo-sqlite-account-0001',
    candidateHash: current.candidateHash,
    operation: current.operation,
    productSymbol: 'BTCUSDT',
    reloadedAt: '2026-07-18T04:00:30.500Z',
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  }
  return Object.freeze({
    guardian: Object.freeze({
      ...common,
      evidenceType: 'GUARDIAN' as const,
      status: 'CLEAR' as const,
      actionAllowed: true as const,
      stateVersionHash: 'a'.repeat(64),
    }),
    risk: Object.freeze({
      ...common,
      evidenceType: 'RISK' as const,
      decisionId: 'demo-sqlite-risk-decision-0001',
      configurationVersion: 'demo-sqlite-risk-v1',
      approved: true as const,
    }),
    idempotency: Object.freeze({
      ...common,
      evidenceType: 'IDEMPOTENCY' as const,
      authorizationId: 'demo-sqlite-authorization-0001',
      dispatchAttemptId: 'demo-sqlite-attempt-0001',
      claimId: 'demo-sqlite-idempotency-claim-0001',
      idempotencyKeyHash: 'b'.repeat(64),
      status: 'CLAIMED' as const,
    }),
  })
}

function configureAuthorizationContext(database: SqliteD1, current: BitgetUnsignedMutationCandidate): void {
  database.database.prepare(`
    INSERT INTO live_step_up_sessions (
      step_up_session_id, actor_id, authentication_method, assurance_level,
      audience, issued_at, expires_at, session_hash
    ) VALUES (?, ?, 'fixture', 'AAL2', 'BITGET_DEMO_DISPATCH', ?, ?, ?)
  `).run(
    'demo-sqlite-step-up-0001',
    'demo-sqlite-risk-approver',
    '2026-07-18T04:00:00.000Z',
    '2026-07-18T04:05:10.000Z',
    HASHES.stepUp,
  )
  database.database.prepare(`
    INSERT INTO live_authorization_events (
      authorization_event_id, actor_id, action, resource_type, resource_id,
      required_roles_json, actor_roles_json, step_up_required,
      step_up_session_id, decision, correlation_id, audit_event_hash,
      occurred_at
    ) VALUES (?, ?, 'BITGET_DEMO_DISPATCH', 'BITGET_DEMO_CANDIDATE', ?,
      '["RISK_OPERATOR"]', '["RISK_OPERATOR"]', 1, ?, 'ALLOW', ?, ?, ?)
  `).run(
    'demo-sqlite-authorization-0001',
    'demo-sqlite-risk-approver',
    current.candidateHash,
    'demo-sqlite-step-up-0001',
    'demo-sqlite-correlation-0001',
    HASHES.authorization,
    '2026-07-18T04:00:05.000Z',
  )
}

function result(current: BitgetUnsignedMutationCandidate): BitgetDemoDispatchResult {
  return Object.freeze({
    environment: 'BITGET_DEMO',
    dispatchAttemptId: 'demo-sqlite-attempt-0001',
    authorizationId: 'demo-sqlite-authorization-0001',
    exchangeAccountId: 'bitget-demo-sqlite-account-0001',
    candidateHash: current.candidateHash,
    operation: current.operation,
    endpoint: current.endpoint,
    category: 'AMBIGUOUS_REQUIRES_LOOKUP',
    reason: 'provider_result_is_ambiguous',
    requestBodyHash: HASHES.request,
    rateLimitReceiptHash: HASHES.rateLimit,
    httpStatus: 400,
    providerCode: '40010',
    providerMessage: 'request timed out',
    acknowledgedOrderId: null,
    acknowledgedClientOrderId: null,
    recoveryLookups: current.recoveryLookups,
    demoRequestSent: true,
    demoProviderMutationAttempted: true,
    requiresReadOnlyRecovery: true,
    providerAcknowledgmentVerified: false,
    realProviderMutationAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
  })
}

test('migrations 025-026 persist reviewed dispatch, fresh-control, and recovery evidence end to end', async () => {
  const database = new SqliteD1()
  try {
    const current = await candidate()
    const evidence = freshEvidence(current)
    const [guardianEvidenceHash, riskEvidenceHash, idempotencyEvidenceHash] = await Promise.all([
      bitgetDemoControlEvidenceBindingHash(evidence.guardian),
      bitgetDemoControlEvidenceBindingHash(evidence.risk),
      bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
    ])
    const input = authorization(current, {
      guardianEvidenceHash,
      riskEvidenceHash,
      idempotencyEvidenceHash,
    })
    configureAuthorizationContext(database, current)
    const authorizationReceipt = await recordReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input,
      '2026-07-18T04:00:06.000Z',
    )
    const reviewed = await loadReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input.authorizationId,
      input.dispatchAttemptId,
      '2026-07-18T04:00:30.000Z',
    )
    const claim = await claimReviewedBitgetDemoDispatchAttempt(
      database.env(),
      reviewed,
      '2026-07-18T04:00:30.000Z',
    )
    const verified = await verifyFreshBitgetDemoControlEvidence(
      evidence,
      current,
      reviewed.authorization,
      '2026-07-18T04:00:30.500Z',
    )
    await assert.rejects(
      recordBitgetDemoControlVerification(
        database.env(),
        current,
        reviewed.authorization,
        { ...verified },
      ),
      /freshly reloaded and in-memory verified control evidence/,
    )
    const controlProjection = await recordBitgetDemoControlVerification(
      database.env(),
      current,
      reviewed.authorization,
      verified,
    )
    const dispatchResult = result(current)
    const projected = await persistBitgetDemoDispatchResult(
      database.env(),
      reviewed,
      claim,
      current,
      dispatchResult,
      '2026-07-18T04:00:31.000Z',
    )
    const dispatch = Object.freeze({
      reviewedAuthorization: reviewed,
      claim,
      result: dispatchResult,
      persistence: projected,
    })
    const recoveryAttempt = await claimBitgetDemoReadOnlyRecoveryAttempt(
      database.env(),
      dispatch,
      '2026-07-18T04:00:32.000Z',
    )
    const recoveryBase: BitgetDemoReadOnlyRecoveryReceiptBase = Object.freeze({
      schemaVersion: 1,
      recoveryId: 'demo-sqlite-recovery-0001',
      dispatchAttemptId: dispatchResult.dispatchAttemptId,
      authorizationId: dispatchResult.authorizationId,
      exchangeAccountId: dispatchResult.exchangeAccountId,
      candidateHash: dispatchResult.candidateHash,
      resultHash: projected.resultHash,
      lookupPlanHash: recoveryAttempt.lookupPlanHash,
      lookupCount: recoveryAttempt.lookupCount,
      status: 'INCOMPLETE',
      snapshotHash: null,
      observedAt: '2026-07-18T04:00:32.500Z',
      readOnly: true,
      providerMutationAllowed: false,
      executionAllowed: false,
      accountingAutomaticallyDispatched: false,
      liveExecutionAllowed: false,
      realFundsAllowed: false,
      mainnetAllowed: false,
      withdrawalsAllowed: false,
      automaticRetryAllowed: false,
    })
    const recoveryReceipt = Object.freeze({
      ...recoveryBase,
      receiptHash: await canonicalHash(recoveryBase),
    })
    const recoveryProjection = await persistBitgetDemoReadOnlyRecoveryReceipt(
      database.env(),
      recoveryAttempt,
      recoveryReceipt,
    )

    assert.equal(authorizationReceipt.projectionStatus, 'PROJECTED')
    assert.equal(controlProjection.projectionStatus, 'PROJECTED')
    assert.equal(projected.projectionStatus, 'PROJECTED')
    assert.equal(projected.recoveryLookupCount, 1)
    assert.equal(recoveryProjection.projectionStatus, 'PROJECTED')
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_dispatch_authorizations').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_dispatch_claims').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_dispatch_results').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_dispatch_recovery_requirements').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_control_verifications').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_recovery_attempts').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_recovery_receipts').get()?.count,
      1,
    )
    assert.equal(
      (await recordBitgetDemoControlVerification(
        database.env(),
        current,
        reviewed.authorization,
        verified,
      )).projectionStatus,
      'REPLAYED',
    )
    assert.equal(
      (await persistBitgetDemoReadOnlyRecoveryReceipt(
        database.env(),
        recoveryAttempt,
        recoveryReceipt,
      )).projectionStatus,
      'REPLAYED',
    )
    await assert.rejects(
      claimBitgetDemoReadOnlyRecoveryAttempt(
        database.env(),
        dispatch,
        '2026-07-18T04:00:33.000Z',
      ),
      /already durably claimed/,
    )
    assert.throws(
      () => database.database.exec(
        "UPDATE live_bitget_demo_dispatch_results SET mainnet_allowed = 1 WHERE dispatch_attempt_id = 'demo-sqlite-attempt-0001';",
      ),
      /cannot be updated/,
    )
    assert.throws(
      () => database.database.exec(
        "DELETE FROM live_bitget_demo_recovery_attempts WHERE dispatch_attempt_id = 'demo-sqlite-attempt-0001';",
      ),
      /cannot be deleted/,
    )
  } finally {
    database.close()
  }
})

test('migration 026 rejects a demo result that has no immutable fresh-control verification', async () => {
  const database = new SqliteD1()
  try {
    const current = await candidate()
    const input = authorization(current)
    configureAuthorizationContext(database, current)
    await recordReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input,
      '2026-07-18T04:00:06.000Z',
    )
    const reviewed = await loadReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input.authorizationId,
      input.dispatchAttemptId,
      '2026-07-18T04:00:30.000Z',
    )
    const claim = await claimReviewedBitgetDemoDispatchAttempt(
      database.env(),
      reviewed,
      '2026-07-18T04:00:30.000Z',
    )
    await assert.rejects(
      persistBitgetDemoDispatchResult(
        database.env(),
        reviewed,
        claim,
        current,
        result(current),
        '2026-07-18T04:00:31.000Z',
      ),
      /result evidence batch was rejected/,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_dispatch_results').get()?.count,
      0,
    )
  } finally {
    database.close()
  }
})

test('source-only runner persists fresh controls before dispatch and one-shot recovery evidence after ambiguity', async () => {
  const database = new SqliteD1()
  try {
    const current = await candidate()
    const evidence = freshEvidence(current)
    const [guardianEvidenceHash, riskEvidenceHash, idempotencyEvidenceHash] = await Promise.all([
      bitgetDemoControlEvidenceBindingHash(evidence.guardian),
      bitgetDemoControlEvidenceBindingHash(evidence.risk),
      bitgetDemoControlEvidenceBindingHash(evidence.idempotency),
    ])
    const input = authorization(current, {
      guardianEvidenceHash,
      riskEvidenceHash,
      idempotencyEvidenceHash,
    })
    configureAuthorizationContext(database, current)
    await recordReviewedBitgetDemoDispatchAuthorization(
      database.env(),
      current,
      input,
      '2026-07-18T04:00:06.000Z',
    )
    const signingMaterial: Readonly<BitgetDemoSigningMaterial> = Object.freeze({
      apiKey: 'fixture-only-access-id',
      secretKey: 'fixture-only-signing-key',
      passphrase: 'fixture-only-passphrase',
    })
    const events: string[] = []
    const outcome = await runReviewedBitgetDemoCertification(
      database.env(),
      Object.freeze({
        authorizationId: input.authorizationId,
        dispatchAttemptId: input.dispatchAttemptId,
        candidate: current,
      }),
      {
        serializer: {
          async run<T>(_accountId: string, operation: () => Promise<T>): Promise<T> {
            events.push('serialized')
            return operation()
          },
        },
        freshControlEvidenceLoader: {
          async load() {
            events.push('fresh-control')
            return evidence
          },
        },
        credentialProvider: {
          async withDemoSigningMaterial<T>(_request, use): Promise<T> {
            events.push('credential-callback')
            return use(signingMaterial)
          },
        },
        rateLimitAuthorityProvider: {
          async forAccount() {
            events.push('rate-authority')
            return {
              async claim(request: Readonly<BitgetDemoRateLimitClaimInput>) {
                events.push('rate-claim')
                return Object.freeze({
                  allowed: true,
                  exchangeAccountId: request.exchangeAccountId,
                  dispatchAttemptId: request.dispatchAttemptId,
                  candidateHash: request.candidateHash,
                  operation: request.operation,
                  claimedAtMs: request.requestedAtMs,
                  windowMs: request.windowMs,
                  maximumRequests: request.maximumRequests,
                  receiptHash: HASHES.rateLimit,
                })
              },
            }
          },
        },
        recoveryBoundary: {
          async recover(request) {
            events.push('read-only-recovery')
            const base: BitgetDemoReadOnlyRecoveryReceiptBase = Object.freeze({
              schemaVersion: 1,
              recoveryId: 'demo-sqlite-runner-recovery-0001',
              dispatchAttemptId: request.result.dispatchAttemptId,
              authorizationId: request.result.authorizationId,
              exchangeAccountId: request.result.exchangeAccountId,
              candidateHash: request.result.candidateHash,
              resultHash: request.resultHash,
              lookupPlanHash: request.lookupPlanHash,
              lookupCount: request.lookups.length,
              status: 'INCOMPLETE',
              snapshotHash: null,
              observedAt: request.requestedAt,
              readOnly: true,
              providerMutationAllowed: false,
              executionAllowed: false,
              accountingAutomaticallyDispatched: false,
              liveExecutionAllowed: false,
              realFundsAllowed: false,
              mainnetAllowed: false,
              withdrawalsAllowed: false,
              automaticRetryAllowed: false,
            })
            return Object.freeze({ ...base, receiptHash: await canonicalHash(base) })
          },
        },
        fetcher: async () => {
          events.push('fetch')
          return new Response(JSON.stringify({
            code: '50000',
            msg: 'provider unavailable',
            data: {},
          }), { status: 503, headers: { 'content-type': 'application/json' } })
        },
        clock: Object.freeze({ now: () => new Date('2026-07-18T04:00:30.500Z') }),
      },
    )

    assert.equal(outcome.dispatch.result.requiresReadOnlyRecovery, true)
    assert.equal(outcome.recoveryAttempt?.oneShot, true)
    assert.equal(outcome.recovery?.status, 'INCOMPLETE')
    assert.equal(outcome.recoveryPersistence?.projectionStatus, 'PROJECTED')
    assert.equal(outcome.providerMutationAllowed, false)
    assert.equal(outcome.executionAllowed, false)
    assert.equal(outcome.automaticRetryAllowed, false)
    assert.deepEqual(events, [
      'serialized',
      'fresh-control',
      'rate-authority',
      'credential-callback',
      'rate-claim',
      'fetch',
      'read-only-recovery',
    ])
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_control_verifications').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_recovery_attempts').get()?.count,
      1,
    )
    assert.equal(
      database.database.prepare('SELECT COUNT(*) AS count FROM live_bitget_demo_recovery_receipts').get()?.count,
      1,
    )
  } finally {
    database.close()
  }
})
