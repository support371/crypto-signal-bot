import {
  runReviewedBitgetDemoCertification,
  type BitgetDemoCertificationOutcome,
} from './demo-certification-runner.ts'
import {
  recordBitgetDemoPlaceControlBinding,
  createD1BitgetDemoFreshControlSource,
  type BitgetDemoGuardianScope,
  type BitgetDemoPlaceControlBindingReceipt,
} from './demo-control-binding-store.ts'
import {
  loadReviewedBitgetDemoDispatchAuthorization,
  type BitgetDemoDispatchEvidenceEnv,
} from './demo-dispatch-evidence-store.ts'
import type {
  BitgetDemoAccountDispatchSerializer,
  BitgetDemoDispatchClock,
  BitgetDemoDispatchOrchestrationInput,
} from './demo-dispatch-orchestrator.ts'
import {
  createBitgetDemoCallbackCredentialProvider,
  createBitgetDemoDurableRateLimitAuthorityProvider,
  createBitgetDemoGetOnlyRecoveryBoundary,
  createVerifiedBitgetDemoFreshControlLoader,
  type BitgetDemoCredentialLeaseSource,
  type BitgetDemoRateLimitNamespace,
  type BitgetDemoReadOnlyLookupSource,
} from './demo-runtime-adapters.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/

interface PermanentCompositionLocks {
  sourceOnly: true
  demoCertificationOnly: true
  providerMutationAllowed: false
  executionAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
  accountingAutomaticallyDispatched: false
}

export interface BitgetDemoCertificationCompositionInput
  extends BitgetDemoDispatchOrchestrationInput {
  controlBinding: Readonly<{
    bindingId: string
    assessmentId: string
    idempotencyOperationId: string
    guardianScopes: readonly BitgetDemoGuardianScope[]
  }>
}

export interface BitgetDemoCertificationCompositionDependencies<RateId> {
  serializer: BitgetDemoAccountDispatchSerializer
  credentialLeaseSource: BitgetDemoCredentialLeaseSource
  rateLimitNamespace: BitgetDemoRateLimitNamespace<RateId>
  recoveryLookupSource: BitgetDemoReadOnlyLookupSource
  fetcher: typeof fetch
  clock: BitgetDemoDispatchClock
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
}

export interface ComposedBitgetDemoCertificationOutcome
  extends PermanentCompositionLocks {
  environment: 'BITGET_DEMO'
  controlBinding: BitgetDemoPlaceControlBindingReceipt
  certification: BitgetDemoCertificationOutcome
}

export class BitgetDemoCertificationCompositionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetDemoCertificationCompositionError'
    this.code = code
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoCertificationCompositionError(
      'COMPOSITION_INPUT_INVALID',
      `${field} is invalid`,
    )
  }
  return normalized
}

function clockIso(clock: BitgetDemoDispatchClock): string {
  if (!clock || typeof clock.now !== 'function') {
    throw new BitgetDemoCertificationCompositionError(
      'CLOCK_REQUIRED',
      'an injected certification clock is required',
    )
  }
  const value = clock.now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new BitgetDemoCertificationCompositionError(
      'CLOCK_INVALID',
      'the injected certification clock returned an invalid Date',
    )
  }
  return value.toISOString()
}

function assertDependencies<RateId>(
  dependencies: BitgetDemoCertificationCompositionDependencies<RateId>,
): void {
  if (!dependencies.serializer || typeof dependencies.serializer.run !== 'function') {
    throw new BitgetDemoCertificationCompositionError(
      'SERIALIZER_REQUIRED',
      'an injected account-scoped serializer is required',
    )
  }
  if (!dependencies.credentialLeaseSource
    || typeof dependencies.credentialLeaseSource.withLease !== 'function') {
    throw new BitgetDemoCertificationCompositionError(
      'CREDENTIAL_LEASE_SOURCE_REQUIRED',
      'an injected callback-scoped demo credential source is required',
    )
  }
  if (!dependencies.rateLimitNamespace
    || typeof dependencies.rateLimitNamespace.idFromName !== 'function'
    || typeof dependencies.rateLimitNamespace.get !== 'function') {
    throw new BitgetDemoCertificationCompositionError(
      'RATE_NAMESPACE_REQUIRED',
      'an injected account-scoped Durable Object namespace is required',
    )
  }
  if (!dependencies.recoveryLookupSource
    || typeof dependencies.recoveryLookupSource.lookup !== 'function') {
    throw new BitgetDemoCertificationCompositionError(
      'RECOVERY_SOURCE_REQUIRED',
      'an injected GET-only recovery source is required',
    )
  }
  if (typeof dependencies.fetcher !== 'function') {
    throw new BitgetDemoCertificationCompositionError(
      'FETCHER_REQUIRED',
      'an injected demo-only fetcher is required',
    )
  }
  clockIso(dependencies.clock)
}

function assertCompositionOutcome(
  outcome: BitgetDemoCertificationOutcome,
  binding: BitgetDemoPlaceControlBindingReceipt,
): void {
  if (
    binding.environment !== 'BITGET_DEMO'
    || binding.sourceOnly !== true
    || binding.providerMutationAllowed !== false
    || binding.executionAllowed !== false
    || binding.liveExecutionAllowed !== false
    || binding.realFundsAllowed !== false
    || binding.mainnetAllowed !== false
    || binding.withdrawalsAllowed !== false
    || binding.automaticRetryAllowed !== false
    || binding.accountingAutomaticallyDispatched !== false
    || outcome.environment !== 'BITGET_DEMO'
    || outcome.demoCertificationOnly !== true
    || outcome.providerMutationAllowed !== false
    || outcome.executionAllowed !== false
    || outcome.liveExecutionAllowed !== false
    || outcome.realFundsAllowed !== false
    || outcome.mainnetAllowed !== false
    || outcome.withdrawalsAllowed !== false
    || outcome.automaticRetryAllowed !== false
  ) {
    throw new BitgetDemoCertificationCompositionError(
      'COMPOSITION_RESULT_INVALID',
      'composed demo certification violated a permanent capability lock',
    )
  }
}

/**
 * Source-only Bitget demo composition.
 *
 * No dependency is selected implicitly. The caller must inject the D1 evidence
 * environment, account serializer, callback-scoped demo credential source,
 * account rate-limit namespace, GET-only recovery source, clock, and fetcher.
 * This module is not imported by a Worker entrypoint and has no route, trigger,
 * Wrangler binding, concrete secret name, default fetcher, live mode, or retry.
 */
export async function runComposedBitgetDemoPlaceCertification<RateId>(
  env: BitgetDemoDispatchEvidenceEnv,
  input: BitgetDemoCertificationCompositionInput,
  dependencies: BitgetDemoCertificationCompositionDependencies<RateId>,
): Promise<ComposedBitgetDemoCertificationOutcome> {
  assertDependencies(dependencies)
  if (input.candidate.operation !== 'PLACE') {
    throw new BitgetDemoCertificationCompositionError(
      'PLACE_ONLY',
      'migration-027 demo certification composition accepts place candidates only',
    )
  }

  const evaluatedAt = clockIso(dependencies.clock)
  const authorizationId = requiredIdentifier(input.authorizationId, 'authorizationId')
  const dispatchAttemptId = requiredIdentifier(input.dispatchAttemptId, 'dispatchAttemptId')
  const bindingId = requiredIdentifier(input.controlBinding.bindingId, 'bindingId')
  const assessmentId = requiredIdentifier(input.controlBinding.assessmentId, 'assessmentId')
  const idempotencyOperationId = requiredIdentifier(
    input.controlBinding.idempotencyOperationId,
    'idempotencyOperationId',
  )

  const reviewed = await loadReviewedBitgetDemoDispatchAuthorization(
    env,
    input.candidate,
    authorizationId,
    dispatchAttemptId,
    evaluatedAt,
  )
  const controlBinding = await recordBitgetDemoPlaceControlBinding(
    env,
    input.candidate,
    reviewed.authorization,
    Object.freeze({
      bindingId,
      assessmentId,
      idempotencyOperationId,
      guardianScopes: input.controlBinding.guardianScopes,
      boundAt: evaluatedAt,
    }),
  )

  const freshControlEvidenceLoader = createVerifiedBitgetDemoFreshControlLoader(
    createD1BitgetDemoFreshControlSource(env),
  )
  const credentialProvider = createBitgetDemoCallbackCredentialProvider(
    dependencies.credentialLeaseSource,
  )
  const rateLimitAuthorityProvider = createBitgetDemoDurableRateLimitAuthorityProvider(
    dependencies.rateLimitNamespace,
  )
  const recoveryBoundary = createBitgetDemoGetOnlyRecoveryBoundary(
    dependencies.recoveryLookupSource,
  )

  const certification = await runReviewedBitgetDemoCertification(
    env,
    Object.freeze({
      authorizationId,
      dispatchAttemptId,
      candidate: input.candidate,
    }),
    Object.freeze({
      serializer: dependencies.serializer,
      freshControlEvidenceLoader,
      credentialProvider,
      rateLimitAuthorityProvider,
      recoveryBoundary,
      fetcher: dependencies.fetcher,
      clock: dependencies.clock,
      timeoutMs: dependencies.timeoutMs,
      maxRequestBytes: dependencies.maxRequestBytes,
      maxResponseBytes: dependencies.maxResponseBytes,
    }),
  )
  assertCompositionOutcome(certification, controlBinding)

  return Object.freeze({
    environment: 'BITGET_DEMO' as const,
    controlBinding,
    certification,
    sourceOnly: true as const,
    demoCertificationOnly: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
    accountingAutomaticallyDispatched: false as const,
  })
}
