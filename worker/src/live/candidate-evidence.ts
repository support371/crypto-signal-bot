import { canonicalHash, canonicalJson } from './canonical-json.ts'
import type {
  CandidateOrderAssessment,
  CandidateOrderAssessmentInput,
} from './candidate-command-plan.ts'
import type { LedgerJournalDraft } from './ledger.ts'

export interface CandidateReservationEvidence {
  reservationJournalId: string
  asset: string
  amount: string
  availableAccountId: string
  reservedAccountId: string
  journalHash: string
  journalJson: string
}

export interface CandidateEvidenceBase {
  schemaVersion: 1
  assessmentId: string
  projectionEventId: string
  internalOrderId: string
  exchangeAccountId: string
  provider: 'BITGET'
  idempotencyKey: string
  requestHash: string
  previewHash: string
  evidenceHash: string
  payloadHash: string
  status: 'REJECTED' | 'READY_BUT_EXECUTION_LOCKED'
  operationalChecksPassed: boolean
  executionAllowed: false
  previewJson: string
  riskDecisionJson: string | null
  reasonsJson: string
  reservation: CandidateReservationEvidence | null
  committedAt: string
}

export interface CandidateEvidenceEnvelope extends CandidateEvidenceBase {
  coordinatorId: string
  coordinatorSequence: number
}

export interface D1CandidateProjectionResult {
  status: 'PROJECTED' | 'REPLAYED'
  assessmentId: string
  projectionEventId: string
  payloadHash: string
}

export class CandidateEvidenceConflictError extends Error {
  readonly code = 'CANDIDATE_EVIDENCE_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'CandidateEvidenceConflictError'
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function isoTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be a valid ISO-8601 timestamp`)
  return new Date(parsed).toISOString()
}

function reservationFields(journal: LedgerJournalDraft): {
  asset: string
  amount: string
  availableAccountId: string
  reservedAccountId: string
} {
  if (journal.entries.length !== 2) {
    throw new TypeError('candidate reservation journal must have exactly two entries')
  }
  const debit = journal.entries.find((entry) => entry.direction === 'DEBIT')
  const credit = journal.entries.find((entry) => entry.direction === 'CREDIT')
  if (!debit || !credit) throw new TypeError('candidate reservation journal must contain debit and credit entries')
  if (debit.asset !== credit.asset || debit.amount !== credit.amount) {
    throw new TypeError('candidate reservation journal entries must balance exactly')
  }
  return {
    asset: debit.asset,
    amount: debit.amount,
    availableAccountId: credit.ledgerAccountId,
    reservedAccountId: debit.ledgerAccountId,
  }
}

function requestEvidence(input: CandidateOrderAssessmentInput): unknown {
  return {
    orderId: input.orderId,
    exchangeAccountId: input.exchangeAccountId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    configurationVersion: input.configurationVersion,
    riskDecisionId: input.riskDecisionId,
    decidedAt: input.decidedAt,
    reservationJournalId: input.reservationJournalId,
    request: input.request,
    preview: {
      productRules: input.previewOptions.productRules,
      referencePrice: input.previewOptions.referencePrice,
      feeRate: input.previewOptions.feeRate,
      slippageBps: input.previewOptions.slippageBps,
    },
    risk: input.risk,
    reservationAccounts: input.reservationAccounts,
  }
}

export async function buildCandidateEvidenceBase(
  input: CandidateOrderAssessmentInput,
  assessment: CandidateOrderAssessment,
  committedAt: string,
): Promise<CandidateEvidenceBase> {
  required(input.orderId, 'orderId')
  required(input.exchangeAccountId, 'exchangeAccountId')
  required(input.idempotencyKey, 'idempotencyKey')
  const normalizedCommittedAt = isoTimestamp(committedAt, 'committedAt')

  if (assessment.provider !== 'BITGET') throw new TypeError('candidate evidence provider must be BITGET')
  if (assessment.executionAllowed !== false) throw new TypeError('candidate evidence cannot allow execution')

  const requestHash = await canonicalHash(requestEvidence(input))
  const previewJson = canonicalJson(assessment.preview)
  const riskDecisionJson = assessment.riskDecision === null
    ? null
    : canonicalJson(assessment.riskDecision)
  const reasonsJson = canonicalJson(assessment.reasons)

  let reservation: CandidateReservationEvidence | null = null
  if (assessment.reservationJournalDraft) {
    const fields = reservationFields(assessment.reservationJournalDraft)
    const journalJson = canonicalJson(assessment.reservationJournalDraft)
    reservation = {
      reservationJournalId: assessment.reservationJournalDraft.journalId,
      ...fields,
      journalHash: await canonicalHash(assessment.reservationJournalDraft),
      journalJson,
    }
  }

  if (assessment.status === 'READY_BUT_EXECUTION_LOCKED' && reservation === null) {
    throw new TypeError('ready candidate assessment requires a reservation draft')
  }
  if (assessment.status === 'REJECTED' && reservation !== null) {
    throw new TypeError('rejected candidate assessment cannot contain a reservation draft')
  }

  const assessmentId = `candidate-assessment-${assessment.evidenceHash.slice(0, 32)}`
  const payloadHash = await canonicalHash({
    schemaVersion: 1,
    assessmentId,
    internalOrderId: input.orderId,
    exchangeAccountId: input.exchangeAccountId,
    provider: assessment.provider,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    previewHash: assessment.preview.rawResponseHash,
    evidenceHash: assessment.evidenceHash,
    status: assessment.status,
    operationalChecksPassed: assessment.operationalChecksPassed,
    executionAllowed: false,
    previewJson,
    riskDecisionJson,
    reasonsJson,
    reservation,
    committedAt: normalizedCommittedAt,
  })

  return Object.freeze({
    schemaVersion: 1,
    assessmentId,
    projectionEventId: `candidate-projection-${payloadHash.slice(0, 32)}`,
    internalOrderId: input.orderId,
    exchangeAccountId: input.exchangeAccountId,
    provider: 'BITGET',
    idempotencyKey: input.idempotencyKey,
    requestHash,
    previewHash: assessment.preview.rawResponseHash,
    evidenceHash: assessment.evidenceHash,
    payloadHash,
    status: assessment.status,
    operationalChecksPassed: assessment.operationalChecksPassed,
    executionAllowed: false,
    previewJson,
    riskDecisionJson,
    reasonsJson,
    reservation,
    committedAt: normalizedCommittedAt,
  })
}

export function attachCoordinatorSequence(
  base: CandidateEvidenceBase,
  coordinatorId: string,
  coordinatorSequence: number,
): CandidateEvidenceEnvelope {
  required(coordinatorId, 'coordinatorId')
  if (!Number.isSafeInteger(coordinatorSequence) || coordinatorSequence < 1) {
    throw new RangeError('coordinatorSequence must be a positive safe integer')
  }
  return Object.freeze({
    ...base,
    coordinatorId,
    coordinatorSequence,
  })
}

type ProjectionReceiptRow = {
  assessment_id: string
  payload_hash: string
}

export async function projectCandidateEvidenceToD1(
  db: D1Database,
  envelope: CandidateEvidenceEnvelope,
): Promise<D1CandidateProjectionResult> {
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT OR IGNORE INTO live_candidate_assessments (
        assessment_id, internal_order_id, exchange_account_id, provider,
        idempotency_key, request_hash, preview_hash, evidence_hash, status,
        operational_checks_passed, execution_allowed, preview_json,
        risk_decision_json, reasons_json, coordinator_id,
        coordinator_sequence, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).bind(
      envelope.assessmentId,
      envelope.internalOrderId,
      envelope.exchangeAccountId,
      envelope.provider,
      envelope.idempotencyKey,
      envelope.requestHash,
      envelope.previewHash,
      envelope.evidenceHash,
      envelope.status,
      envelope.operationalChecksPassed ? 1 : 0,
      envelope.previewJson,
      envelope.riskDecisionJson,
      envelope.reasonsJson,
      envelope.coordinatorId,
      envelope.coordinatorSequence,
      envelope.committedAt,
    ),
  ]

  if (envelope.reservation) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO live_candidate_reservation_drafts (
        reservation_journal_id, assessment_id, exchange_account_id,
        internal_order_id, asset, amount, available_account_id,
        reserved_account_id, journal_hash, journal_json, applied, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(
      envelope.reservation.reservationJournalId,
      envelope.assessmentId,
      envelope.exchangeAccountId,
      envelope.internalOrderId,
      envelope.reservation.asset,
      envelope.reservation.amount,
      envelope.reservation.availableAccountId,
      envelope.reservation.reservedAccountId,
      envelope.reservation.journalHash,
      envelope.reservation.journalJson,
      envelope.committedAt,
    ))
  }

  statements.push(db.prepare(`
    INSERT OR IGNORE INTO live_candidate_projection_receipts (
      projection_event_id, assessment_id, coordinator_id,
      coordinator_sequence, payload_hash, projection_status
    ) VALUES (?, ?, ?, ?, ?, 'PROJECTED')
  `).bind(
    envelope.projectionEventId,
    envelope.assessmentId,
    envelope.coordinatorId,
    envelope.coordinatorSequence,
    envelope.payloadHash,
  ))

  const existingBefore = await db.prepare(`
    SELECT assessment_id, payload_hash
      FROM live_candidate_projection_receipts
     WHERE projection_event_id = ?
  `).bind(envelope.projectionEventId).first<ProjectionReceiptRow>()

  if (existingBefore) {
    if (
      existingBefore.assessment_id !== envelope.assessmentId
      || existingBefore.payload_hash !== envelope.payloadHash
    ) {
      throw new CandidateEvidenceConflictError('D1 projection event conflicts with existing evidence')
    }
    return {
      status: 'REPLAYED',
      assessmentId: envelope.assessmentId,
      projectionEventId: envelope.projectionEventId,
      payloadHash: envelope.payloadHash,
    }
  }

  await db.batch(statements)

  const projected = await db.prepare(`
    SELECT assessment_id, payload_hash
      FROM live_candidate_projection_receipts
     WHERE projection_event_id = ?
  `).bind(envelope.projectionEventId).first<ProjectionReceiptRow>()

  if (!projected) throw new Error('D1 candidate evidence projection receipt is missing')
  if (projected.assessment_id !== envelope.assessmentId || projected.payload_hash !== envelope.payloadHash) {
    throw new CandidateEvidenceConflictError('D1 projection receipt hash mismatch')
  }

  return {
    status: 'PROJECTED',
    assessmentId: envelope.assessmentId,
    projectionEventId: envelope.projectionEventId,
    payloadHash: envelope.payloadHash,
  }
}
