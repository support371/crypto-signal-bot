import type { OrderSide, RiskDecision, RiskRuleResult } from './domain.ts'
import {
  addDecimal,
  asDecimalString,
  compareDecimal,
  isPositiveDecimal,
  type DecimalString,
} from './decimal.ts'

export interface RiskLimits {
  maxOrderNotional: DecimalString
  maxDailyNotional: DecimalString
  maxPositionNotional: DecimalString
  maxOpenOrders: number
}

export interface PreTradeRiskInput {
  decisionId: string
  configurationVersion: string
  decidedAt: string
  side: OrderSide
  orderNotional: DecimalString
  baseQuantity: DecimalString
  dailyTradedNotional: DecimalString
  currentPositionNotional: DecimalString
  availableQuoteBalance: DecimalString
  availableBaseBalance: DecimalString
  openOrderCount: number
  accountEligible: boolean
  releaseActive: boolean
  guardianClear: boolean
  executionUnlocked: boolean
  marketFeedFresh: boolean
  productRulesFresh: boolean
  reconciliationClear: boolean
  idempotencyClaimed: boolean
  limits: RiskLimits
}

function rule(
  name: string,
  passed: boolean,
  reason: string,
  observedValue: RiskRuleResult['observedValue'],
  limitValue: RiskRuleResult['limitValue'],
): RiskRuleResult {
  return {
    rule: name,
    passed,
    reason: passed ? null : reason,
    observedValue,
    limitValue,
  }
}

function validIsoTimestamp(value: string): boolean {
  return Boolean(value) && Number.isFinite(Date.parse(value))
}

export function evaluatePreTradeRisk(input: PreTradeRiskInput): RiskDecision {
  if (!input.decisionId.trim()) throw new TypeError('decisionId is required')
  if (!input.configurationVersion.trim()) throw new TypeError('configurationVersion is required')
  if (!validIsoTimestamp(input.decidedAt)) throw new TypeError('decidedAt must be a valid ISO-8601 timestamp')
  if (!Number.isInteger(input.openOrderCount) || input.openOrderCount < 0) {
    throw new RangeError('openOrderCount must be a non-negative integer')
  }
  if (!Number.isInteger(input.limits.maxOpenOrders) || input.limits.maxOpenOrders < 1) {
    throw new RangeError('maxOpenOrders must be a positive integer')
  }

  const projectedDailyNotional = addDecimal(
    input.dailyTradedNotional,
    input.orderNotional,
  )
  const projectedPositionNotional = input.side === 'BUY'
    ? addDecimal(input.currentPositionNotional, input.orderNotional)
    : input.currentPositionNotional

  const rules: RiskRuleResult[] = [
    rule('account_eligible', input.accountEligible, 'account_not_eligible', input.accountEligible, true),
    rule('release_active', input.releaseActive, 'release_not_active', input.releaseActive, true),
    rule('guardian_clear', input.guardianClear, 'guardian_halted', input.guardianClear, true),
    rule('execution_unlocked', input.executionUnlocked, 'execution_locked', input.executionUnlocked, true),
    rule('market_feed_fresh', input.marketFeedFresh, 'market_feed_stale', input.marketFeedFresh, true),
    rule('product_rules_fresh', input.productRulesFresh, 'product_rules_stale', input.productRulesFresh, true),
    rule('reconciliation_clear', input.reconciliationClear, 'reconciliation_drift_present', input.reconciliationClear, true),
    rule('idempotency_claimed', input.idempotencyClaimed, 'idempotency_not_claimed', input.idempotencyClaimed, true),
    rule(
      'order_notional_positive',
      isPositiveDecimal(input.orderNotional),
      'order_notional_not_positive',
      input.orderNotional,
      asDecimalString('0'),
    ),
    rule(
      'order_notional_limit',
      compareDecimal(input.orderNotional, input.limits.maxOrderNotional) <= 0,
      'order_notional_exceeds_limit',
      input.orderNotional,
      input.limits.maxOrderNotional,
    ),
    rule(
      'daily_notional_limit',
      compareDecimal(projectedDailyNotional, input.limits.maxDailyNotional) <= 0,
      'projected_daily_notional_exceeds_limit',
      projectedDailyNotional,
      input.limits.maxDailyNotional,
    ),
    rule(
      'position_notional_limit',
      compareDecimal(projectedPositionNotional, input.limits.maxPositionNotional) <= 0,
      'projected_position_notional_exceeds_limit',
      projectedPositionNotional,
      input.limits.maxPositionNotional,
    ),
    rule(
      'open_order_limit',
      input.openOrderCount < input.limits.maxOpenOrders,
      'open_order_limit_reached',
      String(input.openOrderCount),
      String(input.limits.maxOpenOrders),
    ),
  ]

  if (input.side === 'BUY') {
    rules.push(rule(
      'available_quote_balance',
      compareDecimal(input.availableQuoteBalance, input.orderNotional) >= 0,
      'insufficient_available_quote_balance',
      input.availableQuoteBalance,
      input.orderNotional,
    ))
  } else {
    rules.push(rule(
      'available_base_balance',
      compareDecimal(input.availableBaseBalance, input.baseQuantity) >= 0,
      'insufficient_available_base_balance',
      input.availableBaseBalance,
      input.baseQuantity,
    ))
  }

  return {
    decisionId: input.decisionId,
    approved: rules.every((result) => result.passed),
    rules,
    configurationVersion: input.configurationVersion,
    decidedAt: new Date(input.decidedAt).toISOString(),
  }
}
