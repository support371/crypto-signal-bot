import { canonicalHash } from '../live/canonical-json.ts'
import {
  accountSpotFillFifo,
  type CostBasisLotState,
  type FillAccountingAccounts,
  type FillAccountingResult,
} from '../live/fill-accounting.ts'
import type { ExchangeFillSnapshot } from '../live/exchange-contracts.ts'
import { asDecimalString, asSignedDecimalString, type SignedDecimalString } from '../live/decimal.ts'
import {
  assertCertificationSignalAssessmentVerified,
  type CertificationSignalAssessment,
} from './signal-assessment-bridge.ts'

const VERIFIED_CERTIFICATION_FILL_SIMULATION = Symbol(
  'verified-certification-fill-simulation',
)

export type CertificationFillSimulationInput = Readonly<{
  assessment: CertificationSignalAssessment
  simulatedAt: string
  existingLots: readonly CostBasisLotState[]
  cumulativeRealizedPnlQuote: SignedDecimalString
  accounts: FillAccountingAccounts
}>

export function assertCertificationFillSimulationVerified(
  simulation: CertificationFillSimulation,
): void {
  if (
    !simulation
    || (simulation as CertificationFillSimulation & {
      [VERIFIED_CERTIFICATION_FILL_SIMULATION]?: boolean
    })[VERIFIED_CERTIFICATION_FILL_SIMULATION] !== true
  ) {
    throw new Error('Certification fill simulation was not verified in this process')
  }
}

export type CertificationFillSimulation = Readonly<{
  version: 'certification-fill-simulation-v1'
  provider: 'BITGET'
  marketDataSource: 'BITGET_PUBLIC_CLOSED_CANDLES'
  signalEvidenceHash: string
  assessmentBindingHash: string
  fill: ExchangeFillSnapshot
  accounting: FillAccountingResult
  simulationHash: string
  providerOrderCreated: false
  providerFillClaimed: false
  reservationApplied: false
  automaticallyPersisted: false
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

function canonicalTimestamp(value: string): string {
  const parsed = Date.parse(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) throw new TypeError('simulatedAt must be ISO-8601')
  const canonical = new Date(parsed).toISOString()
  if (canonical !== value) throw new TypeError('simulatedAt must be canonical ISO-8601')
  return canonical
}

/**
 * Produce a deterministic synthetic fill from an execution-locked local
 * preview, then run the production-grade FIFO accounting calculator against
 * caller-supplied state. No provider response is represented or implied.
 */
export async function simulateCertificationFill(
  input: CertificationFillSimulationInput,
): Promise<CertificationFillSimulation> {
  assertCertificationSignalAssessmentVerified(input.assessment)
  const assessment = input.assessment
  const candidate = assessment.candidateAssessment
  if (
    candidate.status !== 'READY_BUT_EXECUTION_LOCKED'
    || !candidate.operationalChecksPassed
    || candidate.executionAllowed
    || !candidate.preview.accepted
    || candidate.preview.executionAllowed
    || candidate.preview.estimatedFillPrice === null
    || candidate.preview.estimatedBaseQuantity === null
    || candidate.preview.estimatedFees === null
  ) {
    throw new Error('Certification fill simulation requires a ready execution-locked assessment')
  }
  if (assessment.providerMutationAllowed || assessment.executionAllowed
    || assessment.realFundsAllowed || assessment.mainnetAllowed || assessment.withdrawalsAllowed
    || assessment.reservationApplied || assessment.automaticallySubmitted) {
    throw new Error('Certification assessment violates simulation capability locks')
  }

  const simulatedAt = canonicalTimestamp(input.simulatedAt)
  const identifier = assessment.assessmentBindingHash.slice(0, 32)
  const fill: ExchangeFillSnapshot = Object.freeze({
    fillId: `certification-fill:${identifier}`,
    tradeId: `certification-trade:${identifier}`,
    exchangeOrderId: `certification-simulated-order:${identifier}`,
    productId: assessment.productId,
    side: assessment.side,
    price: asDecimalString(candidate.preview.estimatedFillPrice, 'estimatedFillPrice'),
    baseSize: asDecimalString(candidate.preview.estimatedBaseQuantity, 'estimatedBaseQuantity'),
    commission: asDecimalString(candidate.preview.estimatedFees, 'estimatedFees'),
    commissionAsset: assessment.quoteAsset,
    tradeTime: simulatedAt,
    sequenceTimestamp: simulatedAt,
  })
  const accounting = await accountSpotFillFifo({
    journalId: `certification-fill-journal:${identifier}`,
    exchangeAccountId: assessment.exchangeAccountId,
    internalOrderId: assessment.orderId,
    correlationId: assessment.correlationId,
    idempotencyKey: `certification-fill:${assessment.idempotencyKey}`,
    baseAsset: assessment.baseAsset,
    quoteAsset: assessment.quoteAsset,
    fill,
    existingLots: input.existingLots,
    cumulativeRealizedPnlQuote: asSignedDecimalString(
      input.cumulativeRealizedPnlQuote,
      'cumulativeRealizedPnlQuote',
    ),
    feeQuoteValue: fill.commission,
    acquisitionLotId: `certification-lot:${identifier}`,
    accounts: input.accounts,
  })
  if (accounting.providerMutationAllowed || accounting.reservationApplied || accounting.executionAllowed) {
    throw new Error('Certification accounting violated permanent capability locks')
  }

  const base = Object.freeze({
    version: 'certification-fill-simulation-v1' as const,
    provider: 'BITGET' as const,
    marketDataSource: 'BITGET_PUBLIC_CLOSED_CANDLES' as const,
    signalEvidenceHash: assessment.signalEvidenceHash,
    assessmentBindingHash: assessment.assessmentBindingHash,
    fill,
    accounting,
    providerOrderCreated: false as const,
    providerFillClaimed: false as const,
    reservationApplied: false as const,
    automaticallyPersisted: false as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
  })
  const verified = {
    ...base,
    simulationHash: await canonicalHash(base),
  } as CertificationFillSimulation
  Object.defineProperty(verified, VERIFIED_CERTIFICATION_FILL_SIMULATION, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(verified)
}
