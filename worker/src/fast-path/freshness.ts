import {
  DEFAULT_FAST_PATH_THRESHOLDS,
  type FastPathThresholds,
  type FreshnessClass,
  type MarketAuthorizationInput,
  type MarketAuthorizationResult,
} from './types'

export function classifyFreshness(
  eventAgeMs: number | null,
  integrityHealthy: boolean,
  thresholds: Pick<FastPathThresholds, 'greenMaxAgeMs' | 'amberMaxAgeMs'> = DEFAULT_FAST_PATH_THRESHOLDS,
): FreshnessClass {
  if (eventAgeMs === null || !Number.isFinite(eventAgeMs)) return 'not_reported'
  if (!integrityHealthy || eventAgeMs > thresholds.amberMaxAgeMs) return 'red'
  if (eventAgeMs <= thresholds.greenMaxAgeMs) return 'green'
  return 'amber'
}

function reject(
  code: Exclude<MarketAuthorizationResult['code'], 'ALLOWED'>,
  message: string,
): MarketAuthorizationResult {
  return { allowed: false, code, message }
}

export function authorizeMarketAction(input: MarketAuthorizationInput): MarketAuthorizationResult {
  if (input.priceOrigin !== 'live') {
    return reject('NON_EXECUTABLE_PRICE', 'Cache, static, request-provided, or unreported prices are not executable')
  }

  if (input.sequenceState === 'gap' || input.sequenceState === 'out_of_order') {
    return reject('SEQUENCE_GAP', 'Sequence continuity is not healthy')
  }

  if (input.heartbeatState !== 'healthy') {
    return reject('HEARTBEAT_UNHEALTHY', 'A healthy heartbeat is required for executable actions')
  }

  if (input.integrityState !== 'healthy') {
    return reject('STALE_MARKET_DATA', 'Feed integrity is not healthy')
  }

  if (input.action === 'protective_reduction') {
    if (input.freshnessClass === 'green') {
      return { allowed: true, code: 'ALLOWED', message: 'Protective reduction allowed on healthy green data' }
    }
    if (input.freshnessClass === 'amber' && input.secondaryConfirmed) {
      return { allowed: true, code: 'ALLOWED', message: 'Protective reduction allowed on amber data with healthy secondary confirmation' }
    }
    if (input.freshnessClass === 'amber') {
      return reject('SECONDARY_CONFIRMATION_REQUIRED', 'Amber protective reductions require healthy secondary confirmation')
    }
    return reject('STALE_MARKET_DATA', 'Protective reduction requires green data or confirmed amber data')
  }

  if (input.freshnessClass !== 'green') {
    return reject('STALE_MARKET_DATA', 'Entries, scale-ins, and ordinary reductions require green market data')
  }

  if (input.action === 'scale_in' && input.stricterRiskApproved !== true) {
    return reject('INVALID_RISK_DECISION', 'Scale-in requires explicit stricter risk approval')
  }

  return { allowed: true, code: 'ALLOWED', message: 'Action allowed by market integrity policy' }
}
