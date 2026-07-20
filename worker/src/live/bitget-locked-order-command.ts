import { canonicalHash } from './canonical-json.ts'
import {
  assessBitgetCandidateOrder,
  type CandidateOrderAssessment,
  type CandidateOrderAssessmentInput,
} from './candidate-command-plan.ts'
import {
  buildBitgetPlaceOrderCandidate,
  type BitgetTimeInForce,
  type BitgetUnsignedMutationCandidate,
} from './adapters/bitget/execution-candidate.ts'

export interface BitgetLockedOrderCommandInput extends CandidateOrderAssessmentInput {
  clientOrderId: string
  force: BitgetTimeInForce
  candidateBuiltAt: string
  candidateExpiresAt: string
}

export interface BitgetLockedOrderCommand {
  provider: 'BITGET'
  status: 'REJECTED' | 'READY_BUT_EXECUTION_LOCKED'
  assessment: CandidateOrderAssessment
  providerCandidate: BitgetUnsignedMutationCandidate | null
  providerMutationAllowed: false
  executionAllowed: false
  automaticRetryAllowed: false
  automaticallySubmitted: false
  reasons: readonly string[]
  commandHash: string
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be an ISO timestamp`)
  return parsed
}

export async function buildBitgetLockedOrderCommand(
  input: BitgetLockedOrderCommandInput,
): Promise<BitgetLockedOrderCommand> {
  const assessment = await assessBitgetCandidateOrder(input)
  const reasons = new Set<string>(assessment.reasons)
  let providerCandidate: BitgetUnsignedMutationCandidate | null = null

  if (assessment.status === 'READY_BUT_EXECUTION_LOCKED') {
    if (!assessment.preview.accepted || assessment.preview.expiresAt === null) {
      throw new TypeError('ready assessment must contain an accepted, expiring preview')
    }
    if (assessment.reservationJournalDraft === null || assessment.riskDecision === null) {
      throw new TypeError('ready assessment must contain risk and reservation evidence')
    }

    const builtAtMs = timestamp(input.candidateBuiltAt, 'candidateBuiltAt')
    const expiresAtMs = timestamp(input.candidateExpiresAt, 'candidateExpiresAt')
    const previewExpiresAtMs = timestamp(assessment.preview.expiresAt, 'preview.expiresAt')
    if (expiresAtMs <= builtAtMs) throw new TypeError('candidateExpiresAt must be later than candidateBuiltAt')
    if (expiresAtMs > previewExpiresAtMs) {
      throw new TypeError('provider candidate cannot outlive its locked preview')
    }

    providerCandidate = await buildBitgetPlaceOrderCandidate({
      request: input.request,
      productRules: input.previewOptions.productRules,
      clientOrderId: input.clientOrderId,
      previewHash: assessment.preview.rawResponseHash,
      force: input.force,
      builtAt: input.candidateBuiltAt,
      expiresAt: input.candidateExpiresAt,
    })
  } else {
    reasons.add('provider_candidate_not_built')
  }

  reasons.add('execution_locked')
  reasons.add('no_automatic_retry')
  reasons.add('mandatory_read_only_recovery')

  const evidence = {
    provider: 'BITGET' as const,
    status: assessment.status,
    assessmentEvidenceHash: assessment.evidenceHash,
    previewHash: assessment.preview.rawResponseHash,
    riskDecisionId: assessment.riskDecision?.decisionId ?? null,
    reservationJournalId: assessment.reservationJournalDraft?.journalId ?? null,
    providerCandidateHash: providerCandidate?.candidateHash ?? null,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    automaticRetryAllowed: false as const,
    automaticallySubmitted: false as const,
    reasons: Array.from(reasons).sort(),
  }
  const commandHash = await canonicalHash(evidence)

  return Object.freeze({
    provider: 'BITGET',
    status: assessment.status,
    assessment,
    providerCandidate,
    providerMutationAllowed: false,
    executionAllowed: false,
    automaticRetryAllowed: false,
    automaticallySubmitted: false,
    reasons: Object.freeze([...evidence.reasons]),
    commandHash,
  })
}
