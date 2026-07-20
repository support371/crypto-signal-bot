import { canonicalHash } from './canonical-json.ts'
import type { OrderPreviewRequest } from './exchange-contracts.ts'
import {
  buildReservationJournal,
  type LedgerJournalDraft,
} from './ledger.ts'
import {
  evaluatePreTradeRisk,
  type PreTradeRiskInput,
  type RiskLimits,
} from './risk-engine.ts'
import {
  previewBitgetOrderLocked,
  type BitgetLockedPreviewOptions,
  type BitgetLockedPreviewResult,
} from './adapters/bitget/preview.ts'
import type { DecimalString } from './decimal.ts'
import type { RiskDecision } from './domain.ts'

export interface CandidateRiskContext {
  dailyTradedNotional: DecimalString
  currentPositionNotional: DecimalString
  availableQuoteBalance: DecimalString
  availableBaseBalance: DecimalString
  openOrderCount: number
  accountEligible: boolean
  releaseActive: boolean
  guardianClear: boolean
  marketFeedFresh: boolean
  productRulesFresh: boolean
  reconciliationClear: boolean
  idempotencyClaimed: boolean
  limits: RiskLimits
}

export interface CandidateReservationAccounts {
  availableAccountId: string
  reservedAccountId: string
}

export interface CandidateOrderAssessmentInput {
  orderId: string
  exchangeAccountId: string
  correlationId: string
  idempotencyKey: string
  configurationVersion: string
  riskDecisionId: string
  decidedAt: string
  reservationJournalId: string
  request: OrderPreviewRequest
  previewOptions: BitgetLockedPreviewOptions
  risk: CandidateRiskContext
  reservationAccounts: CandidateReservationAccounts
}

export type CandidateOrderAssessmentStatus =
  | 'REJECTED'
  | 'READY_BUT_EXECUTION_LOCKED'

export interface CandidateOrderAssessment {
  status: CandidateOrderAssessmentStatus
  provider: 'BITGET'
  operationalChecksPassed: boolean
  executionAllowed: false
  preview: BitgetLockedPreviewResult
  riskDecision: RiskDecision | null
  reservationJournalDraft: LedgerJournalDraft | null
  reasons: readonly string[]
  evidenceHash: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function riskInput(
  input: CandidateOrderAssessmentInput,
  preview: BitgetLockedPreviewResult,
): PreTradeRiskInput {
  if (
    preview.estimatedBaseQuantity === null
    || preview.estimatedQuoteValue === null
    || (input.request.side === 'BUY' && preview.estimatedTotalDebit === null)
  ) {
    throw new TypeError('accepted preview is missing mandatory risk amounts')
  }

  return {
    decisionId: required(input.riskDecisionId, 'riskDecisionId'),
    configurationVersion: required(input.configurationVersion, 'configurationVersion'),
    decidedAt: input.decidedAt,
    side: input.request.side,
    orderNotional: input.request.side === 'BUY'
      ? preview.estimatedTotalDebit!
      : preview.estimatedQuoteValue,
    baseQuantity: preview.estimatedBaseQuantity,
    dailyTradedNotional: input.risk.dailyTradedNotional,
    currentPositionNotional: input.risk.currentPositionNotional,
    availableQuoteBalance: input.risk.availableQuoteBalance,
    availableBaseBalance: input.risk.availableBaseBalance,
    openOrderCount: input.risk.openOrderCount,
    accountEligible: input.risk.accountEligible,
    releaseActive: input.risk.releaseActive,
    guardianClear: input.risk.guardianClear,
    executionUnlocked: false,
    marketFeedFresh: input.risk.marketFeedFresh,
    productRulesFresh: input.risk.productRulesFresh,
    reconciliationClear: input.risk.reconciliationClear,
    idempotencyClaimed: input.risk.idempotencyClaimed,
    limits: input.risk.limits,
  }
}

function nonExecutionRiskPassed(decision: RiskDecision): boolean {
  return decision.rules
    .filter((result) => result.rule !== 'execution_unlocked')
    .every((result) => result.passed)
}

function reservationDraft(
  input: CandidateOrderAssessmentInput,
  preview: BitgetLockedPreviewResult,
): LedgerJournalDraft {
  if (preview.estimatedBaseQuantity === null || preview.estimatedTotalDebit === null && input.request.side === 'BUY') {
    throw new TypeError('accepted preview is missing mandatory reservation amounts')
  }

  const buy = input.request.side === 'BUY'
  const asset = buy
    ? input.previewOptions.productRules.quoteAsset
    : input.previewOptions.productRules.baseAsset
  const amount = buy ? preview.estimatedTotalDebit! : preview.estimatedBaseQuantity

  return buildReservationJournal({
    journalId: required(input.reservationJournalId, 'reservationJournalId'),
    exchangeAccountId: required(input.exchangeAccountId, 'exchangeAccountId'),
    orderId: required(input.orderId, 'orderId'),
    correlationId: required(input.correlationId, 'correlationId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    asset,
    amount,
    availableAccountId: required(input.reservationAccounts.availableAccountId, 'availableAccountId'),
    reservedAccountId: required(input.reservationAccounts.reservedAccountId, 'reservedAccountId'),
  })
}

export async function assessBitgetCandidateOrder(
  input: CandidateOrderAssessmentInput,
): Promise<CandidateOrderAssessment> {
  required(input.orderId, 'orderId')
  required(input.exchangeAccountId, 'exchangeAccountId')
  required(input.correlationId, 'correlationId')
  required(input.idempotencyKey, 'idempotencyKey')

  const preview = await previewBitgetOrderLocked(input.previewOptions, input.request)
  let riskDecision: RiskDecision | null = null
  let reservationJournalDraft: LedgerJournalDraft | null = null
  let operationalChecksPassed = false
  const reasons = new Set<string>(preview.errors)

  if (preview.accepted) {
    riskDecision = evaluatePreTradeRisk(riskInput(input, preview))
    for (const result of riskDecision.rules) {
      if (!result.passed && result.reason) reasons.add(result.reason)
    }
    operationalChecksPassed = nonExecutionRiskPassed(riskDecision)
    if (operationalChecksPassed) {
      reservationJournalDraft = reservationDraft(input, preview)
    }
  }

  reasons.add('execution_locked')
  const status: CandidateOrderAssessmentStatus = operationalChecksPassed
    ? 'READY_BUT_EXECUTION_LOCKED'
    : 'REJECTED'

  const evidence = {
    provider: 'BITGET',
    status,
    operationalChecksPassed,
    executionAllowed: false,
    previewHash: preview.rawResponseHash,
    riskDecision,
    reservationJournalDraft,
    reasons: Array.from(reasons).sort(),
    orderId: input.orderId,
    exchangeAccountId: input.exchangeAccountId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    configurationVersion: input.configurationVersion,
  }
  const evidenceHash = await canonicalHash(evidence)

  return Object.freeze({
    status,
    provider: 'BITGET',
    operationalChecksPassed,
    executionAllowed: false,
    preview,
    riskDecision,
    reservationJournalDraft,
    reasons: Object.freeze([...evidence.reasons]),
    evidenceHash,
  })
}
