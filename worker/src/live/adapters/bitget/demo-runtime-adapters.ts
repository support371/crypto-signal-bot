import { canonicalHash } from '../../canonical-json.ts'
import {
  verifyFreshBitgetDemoControlEvidence,
  type BitgetDemoAccountRateLimitAuthorityProvider,
  type BitgetDemoCredentialProvider,
  type BitgetDemoCredentialUseRequest,
  type BitgetDemoFreshControlEvidenceInput,
  type BitgetDemoFreshControlEvidenceLoader,
  type BitgetDemoReadOnlyRecoveryBoundary,
  type BitgetDemoReadOnlyRecoveryReceipt,
} from './demo-certification-runner.ts'
import { BitgetDemoDurableRateLimitAuthority } from './demo-rate-limit-authority.ts'
import {
  type BitgetDemoRateLimitAuthority,
  type BitgetDemoRateLimitClaim,
  type BitgetDemoRateLimitClaimInput,
  type BitgetDemoSigningMaterial,
  type VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'
import type {
  BitgetReadOnlyLookupInstruction,
  BitgetUnsignedMutationCandidate,
} from './execution-candidate.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RATE_ACCOUNT_STORAGE_KEY = 'bitget-demo-runtime-rate-account'
const MAX_RATE_REQUEST_BYTES = 4_096

type FreshControlLoadInput = Parameters<BitgetDemoFreshControlEvidenceLoader['load']>[0]
type RecoveryBoundaryInput = Parameters<BitgetDemoReadOnlyRecoveryBoundary['recover']>[0]

interface PermanentDemoLocks {
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

export class BitgetDemoRuntimeAdapterError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetDemoRuntimeAdapterError'
    this.code = code
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoRuntimeAdapterError('RUNTIME_INPUT_INVALID', `${field} is invalid`)
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new BitgetDemoRuntimeAdapterError('RUNTIME_INPUT_INVALID', `${field} must be a SHA-256 digest`)
  }
  return normalized
}

function canonicalTimestamp(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  const parsed = Date.parse(normalized)
  if (!normalized || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new BitgetDemoRuntimeAdapterError('RUNTIME_INPUT_INVALID', `${field} must be a canonical ISO timestamp`)
  }
  return normalized
}

function assertPermanentLocks(value: PermanentDemoLocks, field: string): void {
  if (
    value.liveExecutionAllowed !== false
    || value.realFundsAllowed !== false
    || value.mainnetAllowed !== false
    || value.withdrawalsAllowed !== false
    || value.automaticRetryAllowed !== false
  ) {
    throw new BitgetDemoRuntimeAdapterError(
      'RUNTIME_CAPABILITY_LOCK_INVALID',
      `${field} violates permanent demo-only capability locks`,
    )
  }
}

export interface BitgetDemoCredentialLeaseSource {
  withLease<T>(
    exchangeAccountId: string,
    use: (material: Readonly<BitgetDemoSigningMaterial>) => Promise<T>,
  ): Promise<T>
}

export function createBitgetDemoCallbackCredentialProvider(
  source: BitgetDemoCredentialLeaseSource,
): BitgetDemoCredentialProvider {
  if (!source || typeof source.withLease !== 'function') {
    throw new BitgetDemoRuntimeAdapterError('CREDENTIAL_SOURCE_REQUIRED', 'demo credential lease source is required')
  }
  return Object.freeze({
    async withDemoSigningMaterial<T>(
      request: Readonly<BitgetDemoCredentialUseRequest>,
      use: (material: Readonly<BitgetDemoSigningMaterial>) => Promise<T>,
    ): Promise<T> {
      assertPermanentLocks(request, 'credential use request')
      if (request.environment !== 'BITGET_DEMO' || typeof use !== 'function') {
        throw new BitgetDemoRuntimeAdapterError('CREDENTIAL_REQUEST_INVALID', 'credential use request is invalid')
      }
      const accountId = requiredIdentifier(request.exchangeAccountId, 'exchangeAccountId')
      let callbackCount = 0
      const value = await source.withLease(accountId, async (material) => {
        callbackCount += 1
        if (callbackCount !== 1) {
          throw new BitgetDemoRuntimeAdapterError('CREDENTIAL_LEASE_REUSED', 'demo credential lease is one-shot')
        }
        const frozen = Object.freeze({
          apiKey: String(material.apiKey ?? '').trim(),
          secretKey: String(material.secretKey ?? '').trim(),
          passphrase: String(material.passphrase ?? '').trim(),
        })
        if (!frozen.apiKey || !frozen.secretKey || !frozen.passphrase) {
          throw new BitgetDemoRuntimeAdapterError('CREDENTIAL_MATERIAL_INVALID', 'demo credential material is incomplete')
        }
        return use(frozen)
      })
      if (callbackCount !== 1) {
        throw new BitgetDemoRuntimeAdapterError('CREDENTIAL_LEASE_UNUSED', 'demo credential lease must invoke its callback once')
      }
      return value
    },
  })
}

export interface BitgetDemoFreshControlSource {
  reload(input: Readonly<{
    candidate: BitgetUnsignedMutationCandidate
    authorization: VerifiedBitgetDemoDispatchAuthorization
    evaluatedAt: string
  }>): Promise<BitgetDemoFreshControlEvidenceInput>
}

export function createVerifiedBitgetDemoFreshControlLoader(
  source: BitgetDemoFreshControlSource,
): BitgetDemoFreshControlEvidenceLoader {
  if (!source || typeof source.reload !== 'function') {
    throw new BitgetDemoRuntimeAdapterError('CONTROL_SOURCE_REQUIRED', 'fresh control source is required')
  }
  return Object.freeze({
    async load(input: FreshControlLoadInput): Promise<BitgetDemoFreshControlEvidenceInput> {
      const evidence = await source.reload(input)
      await verifyFreshBitgetDemoControlEvidence(
        evidence,
        input.candidate,
        input.authorization,
        input.evaluatedAt,
      )
      return evidence
    },
  })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function boundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_RATE_REQUEST_BYTES) {
      throw new BitgetDemoRuntimeAdapterError('RATE_REQUEST_TOO_LARGE', 'rate claim request is too large')
    }
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RATE_REQUEST_BYTES) {
    throw new BitgetDemoRuntimeAdapterError('RATE_REQUEST_TOO_LARGE', 'rate claim request is too large')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new BitgetDemoRuntimeAdapterError('RATE_REQUEST_INVALID', 'rate claim request is not valid JSON')
  }
}

export interface BitgetDemoRateLimitObjectState {
  storage: DurableObjectStorage
}

export class BitgetDemoRateLimitDurableObject {
  private readonly state: BitgetDemoRateLimitObjectState

  constructor(state: BitgetDemoRateLimitObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/claim') {
      return json({ error: 'not_found' }, 404)
    }
    try {
      const raw = await boundedJson(request)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BitgetDemoRuntimeAdapterError('RATE_REQUEST_INVALID', 'rate claim request must be an object')
      }
      const input = raw as unknown as BitgetDemoRateLimitClaimInput
      const accountId = requiredIdentifier(input.exchangeAccountId, 'exchangeAccountId')
      const storedAccountId = await this.state.storage.get<string>(RATE_ACCOUNT_STORAGE_KEY)
      if (storedAccountId === undefined) {
        await this.state.storage.put(RATE_ACCOUNT_STORAGE_KEY, accountId)
      } else if (storedAccountId !== accountId) {
        throw new BitgetDemoRuntimeAdapterError('RATE_ACCOUNT_MISMATCH', 'Durable Object account identity is immutable')
      }
      const authority = new BitgetDemoDurableRateLimitAuthority({
        storage: this.state.storage,
        exchangeAccountId: accountId,
      })
      return json(await authority.claim(input))
    } catch (error) {
      const failure = error instanceof BitgetDemoRuntimeAdapterError
        ? error
        : new BitgetDemoRuntimeAdapterError('RATE_CLAIM_FAILED', 'rate claim failed closed')
      return json({ error: failure.code }, 409)
    }
  }
}

function assertRateClaimResponse(
  input: Readonly<BitgetDemoRateLimitClaimInput>,
  value: unknown,
): BitgetDemoRateLimitClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BitgetDemoRuntimeAdapterError('RATE_RESPONSE_INVALID', 'rate-limit response is invalid')
  }
  const result = value as unknown as BitgetDemoRateLimitClaim
  if (
    typeof result.allowed !== 'boolean'
    || result.exchangeAccountId !== input.exchangeAccountId
    || result.dispatchAttemptId !== input.dispatchAttemptId
    || result.candidateHash !== input.candidateHash
    || result.operation !== input.operation
    || result.windowMs !== input.windowMs
    || result.maximumRequests !== input.maximumRequests
    || !Number.isSafeInteger(result.claimedAtMs)
    || !SHA256_PATTERN.test(String(result.receiptHash ?? ''))
  ) {
    throw new BitgetDemoRuntimeAdapterError('RATE_RESPONSE_INVALID', 'rate-limit response conflicts with the claim')
  }
  return Object.freeze({ ...result })
}

export interface BitgetDemoRateLimitStub {
  fetch(request: Request): Promise<Response>
}

export interface BitgetDemoRateLimitNamespace<Id> {
  idFromName(name: string): Id
  get(id: Id): BitgetDemoRateLimitStub
}

export function createBitgetDemoDurableRateLimitAuthorityProvider<Id>(
  namespace: BitgetDemoRateLimitNamespace<Id>,
): BitgetDemoAccountRateLimitAuthorityProvider {
  if (!namespace || typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
    throw new BitgetDemoRuntimeAdapterError('RATE_NAMESPACE_REQUIRED', 'Durable Object namespace is required')
  }
  return Object.freeze({
    async forAccount(exchangeAccountId: string): Promise<BitgetDemoRateLimitAuthority> {
      const accountId = requiredIdentifier(exchangeAccountId, 'exchangeAccountId')
      const stub = namespace.get(namespace.idFromName(`bitget-demo-rate:${accountId}`))
      return Object.freeze({
        async claim(input: Readonly<BitgetDemoRateLimitClaimInput>): Promise<BitgetDemoRateLimitClaim> {
          if (input.exchangeAccountId !== accountId) {
            throw new BitgetDemoRuntimeAdapterError('RATE_ACCOUNT_MISMATCH', 'rate claim account does not match provider scope')
          }
          const response = await stub.fetch(new Request('https://bitget-demo-rate.internal/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }))
          if (!response.ok) {
            throw new BitgetDemoRuntimeAdapterError('RATE_CLAIM_REJECTED', 'Durable rate-limit claim was rejected')
          }
          return assertRateClaimResponse(input, await response.json())
        },
      })
    },
  })
}

export type BitgetDemoReadOnlyLookupStatus = 'FOUND' | 'NOT_FOUND' | 'ERROR'

export interface BitgetDemoReadOnlyLookupObservation extends PermanentDemoLocks {
  status: BitgetDemoReadOnlyLookupStatus
  observedAt: string
  orderId: string | null
  clientOrderId: string | null
  payloadHash: string | null
  providerMutationAllowed: false
  executionAllowed: false
  readOnly: true
}

export interface BitgetDemoReadOnlyLookupSource {
  lookup(
    instruction: BitgetReadOnlyLookupInstruction,
    requestedAt: string,
  ): Promise<BitgetDemoReadOnlyLookupObservation>
}

function assertLookupObservation(
  instruction: BitgetReadOnlyLookupInstruction,
  observation: BitgetDemoReadOnlyLookupObservation,
  requestedAt: string,
): BitgetDemoReadOnlyLookupObservation {
  assertPermanentLocks(observation, 'read-only lookup observation')
  const observedAt = canonicalTimestamp(observation.observedAt, 'observedAt')
  if (
    observation.readOnly !== true
    || observation.providerMutationAllowed !== false
    || observation.executionAllowed !== false
    || Date.parse(observedAt) < Date.parse(requestedAt)
    || !['FOUND', 'NOT_FOUND', 'ERROR'].includes(observation.status)
    || (observation.payloadHash !== null && !SHA256_PATTERN.test(observation.payloadHash))
  ) {
    throw new BitgetDemoRuntimeAdapterError('RECOVERY_OBSERVATION_INVALID', 'read-only recovery observation is invalid')
  }
  if (observation.status === 'FOUND') {
    const expectedOrderId = instruction.query.orderId ?? null
    const expectedClientOrderId = instruction.query.clientOid ?? null
    if (
      (expectedOrderId !== null && observation.orderId !== expectedOrderId)
      || (expectedClientOrderId !== null && observation.clientOrderId !== expectedClientOrderId)
      || observation.payloadHash === null
    ) {
      throw new BitgetDemoRuntimeAdapterError('RECOVERY_IDENTITY_MISMATCH', 'recovery observation identity does not match lookup')
    }
  }
  return Object.freeze({ ...observation, observedAt })
}

export function createBitgetDemoGetOnlyRecoveryBoundary(
  source: BitgetDemoReadOnlyLookupSource,
): BitgetDemoReadOnlyRecoveryBoundary {
  if (!source || typeof source.lookup !== 'function') {
    throw new BitgetDemoRuntimeAdapterError('RECOVERY_SOURCE_REQUIRED', 'GET-only recovery source is required')
  }
  return Object.freeze({
    async recover(input: RecoveryBoundaryInput): Promise<BitgetDemoReadOnlyRecoveryReceipt> {
      const requestedAt = canonicalTimestamp(input.requestedAt, 'requestedAt')
      requiredHash(input.resultHash, 'resultHash')
      requiredHash(input.lookupPlanHash, 'lookupPlanHash')
      if (input.lookups.length < 1 || input.lookups.length > 2) {
        throw new BitgetDemoRuntimeAdapterError('RECOVERY_PLAN_INVALID', 'recovery requires one or two GET lookups')
      }
      for (const lookup of input.lookups) {
        if (lookup.method !== 'GET') {
          throw new BitgetDemoRuntimeAdapterError('RECOVERY_PLAN_INVALID', 'recovery source accepts GET lookups only')
        }
      }
      const observations: BitgetDemoReadOnlyLookupObservation[] = []
      for (const lookup of input.lookups) {
        observations.push(assertLookupObservation(
          lookup,
          await source.lookup(lookup, requestedAt),
          requestedAt,
        ))
      }
      const recovered = observations.every((observation) => observation.status === 'FOUND')
      const observedTimes = observations.map((observation) => observation.observedAt).sort()
      const observedAt = observedTimes[observedTimes.length - 1]!
      const snapshotHash = recovered
        ? await canonicalHash({
          resultHash: input.resultHash,
          lookupPlanHash: input.lookupPlanHash,
          observations,
        })
        : null
      const status: 'RECOVERED' | 'INCOMPLETE' = recovered ? 'RECOVERED' : 'INCOMPLETE'
      const base = Object.freeze({
        schemaVersion: 1 as const,
        recoveryId: `bitget-demo-recovery:${requiredIdentifier(input.result.dispatchAttemptId, 'dispatchAttemptId')}`,
        dispatchAttemptId: input.result.dispatchAttemptId,
        authorizationId: input.result.authorizationId,
        exchangeAccountId: input.result.exchangeAccountId,
        candidateHash: input.result.candidateHash,
        resultHash: input.resultHash,
        lookupPlanHash: input.lookupPlanHash,
        lookupCount: input.lookups.length,
        status,
        snapshotHash,
        observedAt,
        readOnly: true as const,
        providerMutationAllowed: false as const,
        executionAllowed: false as const,
        accountingAutomaticallyDispatched: false as const,
        liveExecutionAllowed: false as const,
        realFundsAllowed: false as const,
        mainnetAllowed: false as const,
        withdrawalsAllowed: false as const,
        automaticRetryAllowed: false as const,
      })
      return Object.freeze({ ...base, receiptHash: await canonicalHash(base) })
    },
  })
}
