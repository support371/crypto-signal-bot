import { canonicalHash } from '../live/canonical-json.ts'
import {
  assessBitgetCandidateOrder,
  type CandidateOrderAssessment,
  type CandidateOrderAssessmentInput,
} from '../live/candidate-command-plan.ts'
import { compareDecimal } from '../live/decimal.ts'
import {
  verifyCertificationSignalEvidence,
  type CertificationSignalEvidence,
} from './signal-engine.ts'

const VERIFIED_CERTIFICATION_SIGNAL_ASSESSMENT = Symbol(
  'verified-certification-signal-assessment',
)

export type CertificationSignalAssessment = Readonly<{
  version: 'certification-signal-assessment-v1'
  provider: 'BITGET'
  signalEvidenceHash: string
  orderId: string
  exchangeAccountId: string
  correlationId: string
  idempotencyKey: string
  productId: string
  baseAsset: string
  quoteAsset: string
  side: 'BUY' | 'SELL'
  candidateAssessment: CandidateOrderAssessment
  assessmentBindingHash: string
  reservationApplied: false
  automaticallySubmitted: false
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

export function assertCertificationSignalAssessmentVerified(
  assessment: CertificationSignalAssessment,
): void {
  if (
    !assessment
    || (assessment as CertificationSignalAssessment & {
      [VERIFIED_CERTIFICATION_SIGNAL_ASSESSMENT]?: boolean
    })[VERIFIED_CERTIFICATION_SIGNAL_ASSESSMENT] !== true
  ) {
    throw new Error('Certification signal assessment was not verified in this process')
  }
}

function normalizedProduct(value: string): string {
  return value.trim().toUpperCase().replace(/[-_/]/g, '')
}

/**
 * Bind immutable, real-market signal evidence to the existing exact preview,
 * deterministic risk, and reservation-draft assessment. The result is evidence
 * only: it cannot apply a reservation or reach an exchange mutation adapter.
 */
export async function assessCertificationSignalCandidate(
  signal: CertificationSignalEvidence,
  input: CandidateOrderAssessmentInput,
  nowMs: number,
): Promise<CertificationSignalAssessment> {
  await verifyCertificationSignalEvidence(signal, nowMs)
  if (signal.direction === 'HOLD') {
    throw new Error('HOLD certification signals cannot create an order assessment')
  }
  if (input.request.orderType !== 'MARKET') {
    throw new Error('Certification signal assessment supports MARKET order rehearsals only')
  }
  if (input.request.side !== signal.direction) {
    throw new Error('Candidate order side does not match certification signal direction')
  }
  const signalProduct = normalizedProduct(signal.productSymbol)
  if (normalizedProduct(input.request.productId) !== signalProduct
    || normalizedProduct(input.previewOptions.productRules.productId) !== signalProduct
    || normalizedProduct(input.previewOptions.referencePrice.productId) !== signalProduct) {
    throw new Error('Candidate product does not match certification signal product')
  }
  if (compareDecimal(input.previewOptions.referencePrice.price, signal.referencePrice) !== 0) {
    throw new Error('Candidate reference price does not match certification signal evidence')
  }
  if (Date.parse(input.previewOptions.referencePrice.observedAt) !== signal.latestClosedAtMs) {
    throw new Error('Candidate reference-price timestamp does not match certification signal evidence')
  }

  const candidateAssessment = await assessBitgetCandidateOrder(input)
  const binding = {
    version: 'certification-signal-assessment-v1' as const,
    provider: 'BITGET' as const,
    signalEvidenceHash: signal.evidenceHash,
    candidateAssessmentHash: candidateAssessment.evidenceHash,
    orderId: input.orderId,
    exchangeAccountId: input.exchangeAccountId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    productId: input.previewOptions.productRules.productId,
    baseAsset: input.previewOptions.productRules.baseAsset,
    quoteAsset: input.previewOptions.productRules.quoteAsset,
    side: input.request.side,
    reservationApplied: false as const,
    automaticallySubmitted: false as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
  }
  const verified = {
    version: binding.version,
    provider: binding.provider,
    signalEvidenceHash: signal.evidenceHash,
    orderId: binding.orderId,
    exchangeAccountId: binding.exchangeAccountId,
    correlationId: binding.correlationId,
    idempotencyKey: binding.idempotencyKey,
    productId: binding.productId,
    baseAsset: binding.baseAsset,
    quoteAsset: binding.quoteAsset,
    side: binding.side,
    candidateAssessment,
    assessmentBindingHash: await canonicalHash(binding),
    reservationApplied: false,
    automaticallySubmitted: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  } as CertificationSignalAssessment
  Object.defineProperty(verified, VERIFIED_CERTIFICATION_SIGNAL_ASSESSMENT, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(verified)
}
