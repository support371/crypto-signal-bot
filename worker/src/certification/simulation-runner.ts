import type { CandidateOrderAssessmentInput } from '../live/candidate-command-plan.ts'
import type { CostBasisLotState, FillAccountingAccounts } from '../live/fill-accounting.ts'
import type { SignedDecimalString } from '../live/decimal.ts'
import { fetchBitgetPublicClosedCandles, type BitgetPublicCandleDependencies } from './bitget-public-candles.ts'
import {
  persistCertificationEvidence,
  type CertificationEvidenceProjectionReceipt,
  type CertificationEvidenceStoreEnv,
} from './evidence-store.ts'
import { simulateCertificationFill, type CertificationFillSimulation } from './fill-simulation.ts'
import {
  assessCertificationSignalCandidate,
  type CertificationSignalAssessment,
} from './signal-assessment-bridge.ts'
import { evaluateCertificationSignal, type CertificationSignalEvidence } from './signal-engine.ts'

const FIVE_MINUTES_MS = 5 * 60 * 1000

interface PermanentSimulationLocks {
  automaticallyPersisted: false
  providerOrderCreated: false
  providerFillClaimed: false
  reservationApplied: false
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

export type CertificationSimulationState = Readonly<{
  existingLots: readonly CostBasisLotState[]
  cumulativeRealizedPnlQuote: SignedDecimalString
  accounts: FillAccountingAccounts
}>

export type ExplicitCertificationProjection = Readonly<{
  requestedByCaller: true
  env: CertificationEvidenceStoreEnv
}>

export type CertificationSimulationRunnerDependencies = Readonly<{
  fetcher: NonNullable<BitgetPublicCandleDependencies['fetcher']>
  clock: Readonly<{ now(): Date }>
  buildAssessmentInput(signal: CertificationSignalEvidence): CandidateOrderAssessmentInput
  explicitProjection?: ExplicitCertificationProjection
}>

export type CertificationSimulationRunnerOutcome = Readonly<
  PermanentSimulationLocks & {
    version: 'certification-simulation-runner-v1'
    provider: 'BITGET'
    status: 'NO_ACTION' | 'SIMULATED' | 'SIMULATED_AND_PROJECTED'
    evaluatedAt: string
    signal: CertificationSignalEvidence
    assessment: CertificationSignalAssessment | null
    simulation: CertificationFillSimulation | null
    projection: CertificationEvidenceProjectionReceipt | null
  }
>

export class CertificationSimulationRunnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CertificationSimulationRunnerError'
  }
}

const LOCKS: PermanentSimulationLocks = Object.freeze({
  automaticallyPersisted: false,
  providerOrderCreated: false,
  providerFillClaimed: false,
  reservationApplied: false,
  providerMutationAllowed: false,
  executionAllowed: false,
  realFundsAllowed: false,
  mainnetAllowed: false,
  withdrawalsAllowed: false,
  automaticRetryAllowed: false,
})

function trustedNow(clock: CertificationSimulationRunnerDependencies['clock']): {
  milliseconds: number
  iso: string
} {
  if (!clock || typeof clock.now !== 'function') {
    throw new CertificationSimulationRunnerError('an injected trusted clock is required')
  }
  const date = clock.now()
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new CertificationSimulationRunnerError('the injected clock returned an invalid Date')
  }
  return { milliseconds: date.getTime(), iso: date.toISOString() }
}

function assertDependencies(dependencies: CertificationSimulationRunnerDependencies): void {
  if (typeof dependencies.fetcher !== 'function') {
    throw new CertificationSimulationRunnerError('an injected public-market fetcher is required')
  }
  if (typeof dependencies.buildAssessmentInput !== 'function') {
    throw new CertificationSimulationRunnerError('an independent assessment-input builder is required')
  }
  if (dependencies.explicitProjection && dependencies.explicitProjection.requestedByCaller !== true) {
    throw new CertificationSimulationRunnerError('D1 projection must be explicitly requested by the caller')
  }
}

function noAction(
  signal: CertificationSignalEvidence,
  evaluatedAt: string,
): CertificationSimulationRunnerOutcome {
  return Object.freeze({
    version: 'certification-simulation-runner-v1',
    provider: 'BITGET',
    status: 'NO_ACTION',
    evaluatedAt,
    signal,
    assessment: null,
    simulation: null,
    projection: null,
    ...LOCKS,
  })
}

/**
 * Compose the complete credential-free certification rehearsal. This module is
 * source-only and requires every authority-bearing dependency to be injected.
 * It has no route, trigger, default fetcher, credential binding, provider write,
 * retry loop, or automatic D1 projection.
 */
export async function runBitgetCertificationSimulation(
  productSymbol: string,
  state: CertificationSimulationState,
  dependencies: CertificationSimulationRunnerDependencies,
): Promise<CertificationSimulationRunnerOutcome> {
  assertDependencies(dependencies)
  const now = trustedNow(dependencies.clock)
  const snapshot = await fetchBitgetPublicClosedCandles(productSymbol, {
    fetcher: dependencies.fetcher,
    now: () => now.milliseconds,
  })
  const signal = await evaluateCertificationSignal(snapshot, now.milliseconds)
  if (signal.direction === 'HOLD') return noAction(signal, now.iso)

  const supplied = dependencies.buildAssessmentInput(signal)
  if (!supplied || Date.parse(supplied.decidedAt) !== now.milliseconds) {
    throw new CertificationSimulationRunnerError(
      'independent risk decision must bind the trusted evaluation timestamp',
    )
  }
  const assessmentInput: CandidateOrderAssessmentInput = {
    ...supplied,
    previewOptions: {
      ...supplied.previewOptions,
      referencePrice: {
        productId: supplied.previewOptions.productRules.productId,
        price: signal.referencePrice,
        observedAt: new Date(signal.latestClosedAtMs).toISOString(),
        expiresAt: new Date(signal.latestClosedAtMs + FIVE_MINUTES_MS).toISOString(),
      },
      now: () => new Date(now.milliseconds),
    },
  }
  const assessment = await assessCertificationSignalCandidate(signal, assessmentInput, now.milliseconds)
  const simulation = await simulateCertificationFill({
    assessment,
    simulatedAt: now.iso,
    existingLots: state.existingLots,
    cumulativeRealizedPnlQuote: state.cumulativeRealizedPnlQuote,
    accounts: state.accounts,
  })
  const projection = dependencies.explicitProjection
    ? await persistCertificationEvidence(
      dependencies.explicitProjection.env,
      signal,
      assessment,
      simulation,
      now.iso,
    )
    : null

  return Object.freeze({
    version: 'certification-simulation-runner-v1',
    provider: 'BITGET',
    status: projection ? 'SIMULATED_AND_PROJECTED' : 'SIMULATED',
    evaluatedAt: now.iso,
    signal,
    assessment,
    simulation,
    projection,
    ...LOCKS,
  })
}
