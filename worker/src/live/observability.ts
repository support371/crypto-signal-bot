import {
  asDecimalString,
  compareDecimal,
  type DecimalString,
} from './decimal.ts'

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface OperationalThresholds {
  maximumUnresolvedOrders: number
  maximumReconciliationAgeMs: number
  maximumMarketFeedAgeMs: number
  maximumUserStreamAgeMs: number
  maximumQueueDeadLetters: number
  maximumAuthenticationErrors: number
  maximumOrderRejections: number
  maximumBalanceDrift: DecimalString
  maximumLedgerImbalance: DecimalString
  maximumWithdrawalAnomalies: number
}

export interface OperationalSnapshot {
  exchangeAccountId: string
  unresolvedOrders: number
  reconciliationAgeMs: number | null
  marketFeedAgeMs: number | null
  userStreamAgeMs: number | null
  queueDeadLetters: number
  authenticationErrors: number
  orderRejections: number
  balanceDrift: DecimalString
  ledgerImbalance: DecimalString
  withdrawalAnomalies: number
  releaseMatchesDeployment: boolean
  guardianHalted: boolean
  candidateExecutionLocked: boolean
  observedAt: string
}

export interface OperationalAlert {
  alertKey: string
  severity: AlertSeverity
  reasonCode: string
  summary: string
  detail: Readonly<Record<string, string | number | boolean | null>>
  guardianAction: 'NONE' | 'RESTRICT_ACCOUNT' | 'HALT_ACCOUNT' | 'HALT_WITHDRAWALS'
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`)
  }
  return value
}

function nonNegativeAge(value: number | null, field: string): number | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative finite number or null`)
  }
  return value
}

function alert(
  alertKey: string,
  severity: AlertSeverity,
  reasonCode: string,
  summary: string,
  detail: OperationalAlert['detail'],
  guardianAction: OperationalAlert['guardianAction'],
): OperationalAlert {
  return { alertKey, severity, reasonCode, summary, detail, guardianAction }
}

export function evaluateOperationalAlerts(
  snapshot: OperationalSnapshot,
  thresholds: OperationalThresholds,
): readonly OperationalAlert[] {
  if (!snapshot.exchangeAccountId.trim()) throw new TypeError('exchangeAccountId is required')
  if (!Number.isFinite(Date.parse(snapshot.observedAt))) {
    throw new TypeError('observedAt must be ISO-8601')
  }

  const unresolvedOrders = nonNegativeInteger(snapshot.unresolvedOrders, 'unresolvedOrders')
  const reconciliationAgeMs = nonNegativeAge(snapshot.reconciliationAgeMs, 'reconciliationAgeMs')
  const marketFeedAgeMs = nonNegativeAge(snapshot.marketFeedAgeMs, 'marketFeedAgeMs')
  const userStreamAgeMs = nonNegativeAge(snapshot.userStreamAgeMs, 'userStreamAgeMs')
  const queueDeadLetters = nonNegativeInteger(snapshot.queueDeadLetters, 'queueDeadLetters')
  const authenticationErrors = nonNegativeInteger(snapshot.authenticationErrors, 'authenticationErrors')
  const orderRejections = nonNegativeInteger(snapshot.orderRejections, 'orderRejections')
  const withdrawalAnomalies = nonNegativeInteger(snapshot.withdrawalAnomalies, 'withdrawalAnomalies')
  const alerts: OperationalAlert[] = []

  if (!snapshot.candidateExecutionLocked) {
    alerts.push(alert(
      'candidate-execution-unlocked',
      'CRITICAL',
      'CANDIDATE_EXECUTION_UNLOCKED',
      'Disabled candidate execution lock is not active',
      { candidateExecutionLocked: false },
      'HALT_ACCOUNT',
    ))
  }

  if (!snapshot.releaseMatchesDeployment) {
    alerts.push(alert(
      'release-deployment-mismatch',
      'CRITICAL',
      'RELEASE_DEPLOYMENT_MISMATCH',
      'Runtime deployment does not match the authorized release evidence',
      { releaseMatchesDeployment: false },
      'HALT_ACCOUNT',
    ))
  }

  if (unresolvedOrders > thresholds.maximumUnresolvedOrders) {
    alerts.push(alert(
      'unresolved-orders',
      'CRITICAL',
      'UNRESOLVED_ORDERS_EXCEEDED',
      'Unresolved exchange orders exceed the configured limit',
      { observed: unresolvedOrders, limit: thresholds.maximumUnresolvedOrders },
      'HALT_ACCOUNT',
    ))
  }

  if (reconciliationAgeMs === null || reconciliationAgeMs > thresholds.maximumReconciliationAgeMs) {
    alerts.push(alert(
      'reconciliation-stale',
      'CRITICAL',
      'RECONCILIATION_STALE',
      'Account reconciliation is missing or stale',
      { observedAgeMs: reconciliationAgeMs, limitMs: thresholds.maximumReconciliationAgeMs },
      'HALT_ACCOUNT',
    ))
  }

  if (marketFeedAgeMs === null || marketFeedAgeMs > thresholds.maximumMarketFeedAgeMs) {
    alerts.push(alert(
      'market-feed-stale',
      'CRITICAL',
      'MARKET_FEED_STALE',
      'Market feed is missing or stale',
      { observedAgeMs: marketFeedAgeMs, limitMs: thresholds.maximumMarketFeedAgeMs },
      'HALT_ACCOUNT',
    ))
  }

  if (userStreamAgeMs === null || userStreamAgeMs > thresholds.maximumUserStreamAgeMs) {
    alerts.push(alert(
      'user-stream-stale',
      'CRITICAL',
      'USER_STREAM_STALE',
      'Authenticated user-order stream is missing or stale',
      { observedAgeMs: userStreamAgeMs, limitMs: thresholds.maximumUserStreamAgeMs },
      'HALT_ACCOUNT',
    ))
  }

  if (queueDeadLetters > thresholds.maximumQueueDeadLetters) {
    alerts.push(alert(
      'queue-dead-letters',
      'CRITICAL',
      'QUEUE_DEAD_LETTERS_EXCEEDED',
      'Dead-letter queue records exceed the configured limit',
      { observed: queueDeadLetters, limit: thresholds.maximumQueueDeadLetters },
      'RESTRICT_ACCOUNT',
    ))
  }

  if (authenticationErrors > thresholds.maximumAuthenticationErrors) {
    alerts.push(alert(
      'authentication-errors',
      'WARNING',
      'AUTHENTICATION_ERRORS_EXCEEDED',
      'Authentication failures exceed the configured limit',
      { observed: authenticationErrors, limit: thresholds.maximumAuthenticationErrors },
      'RESTRICT_ACCOUNT',
    ))
  }

  if (orderRejections > thresholds.maximumOrderRejections) {
    alerts.push(alert(
      'order-rejections',
      'WARNING',
      'ORDER_REJECTIONS_EXCEEDED',
      'Exchange order rejections exceed the configured limit',
      { observed: orderRejections, limit: thresholds.maximumOrderRejections },
      'RESTRICT_ACCOUNT',
    ))
  }

  if (compareDecimal(snapshot.balanceDrift, thresholds.maximumBalanceDrift) > 0) {
    alerts.push(alert(
      'balance-drift',
      'CRITICAL',
      'BALANCE_DRIFT_EXCEEDED',
      'Exchange and internal balances differ beyond tolerance',
      { observed: snapshot.balanceDrift, limit: thresholds.maximumBalanceDrift },
      'HALT_ACCOUNT',
    ))
  }

  if (compareDecimal(snapshot.ledgerImbalance, thresholds.maximumLedgerImbalance) > 0) {
    alerts.push(alert(
      'ledger-imbalance',
      'CRITICAL',
      'LEDGER_IMBALANCE_DETECTED',
      'Double-entry ledger is not balanced within tolerance',
      { observed: snapshot.ledgerImbalance, limit: thresholds.maximumLedgerImbalance },
      'HALT_ACCOUNT',
    ))
  }

  if (withdrawalAnomalies > thresholds.maximumWithdrawalAnomalies) {
    alerts.push(alert(
      'withdrawal-anomalies',
      'CRITICAL',
      'WITHDRAWAL_ANOMALIES_EXCEEDED',
      'Withdrawal anomalies exceed the configured limit',
      { observed: withdrawalAnomalies, limit: thresholds.maximumWithdrawalAnomalies },
      'HALT_WITHDRAWALS',
    ))
  }

  if (snapshot.guardianHalted) {
    alerts.push(alert(
      'guardian-halted',
      'INFO',
      'GUARDIAN_ALREADY_HALTED',
      'Guardian is already preventing new financial commands',
      { guardianHalted: true },
      'NONE',
    ))
  }

  return alerts.sort((left, right) => {
    const priority: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }
    const severity = priority[left.severity] - priority[right.severity]
    return severity !== 0 ? severity : left.alertKey.localeCompare(right.alertKey)
  })
}

export function defaultCandidateThresholds(): OperationalThresholds {
  return {
    maximumUnresolvedOrders: 0,
    maximumReconciliationAgeMs: 60_000,
    maximumMarketFeedAgeMs: 15_000,
    maximumUserStreamAgeMs: 30_000,
    maximumQueueDeadLetters: 0,
    maximumAuthenticationErrors: 5,
    maximumOrderRejections: 3,
    maximumBalanceDrift: asDecimalString('0'),
    maximumLedgerImbalance: asDecimalString('0'),
    maximumWithdrawalAnomalies: 0,
  }
}
