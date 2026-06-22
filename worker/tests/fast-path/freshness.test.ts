import { describe, expect, it } from 'vitest'
import { authorizeMarketAction, classifyFreshness } from '../../src/fast-path/freshness'

describe('freshness and action authorization', () => {
  it('moves from green to amber to red at configured thresholds', () => {
    expect(classifyFreshness(500, true)).toBe('green')
    expect(classifyFreshness(501, true)).toBe('amber')
    expect(classifyFreshness(1500, true)).toBe('amber')
    expect(classifyFreshness(1501, true)).toBe('red')
    expect(classifyFreshness(100, false)).toBe('red')
    expect(classifyFreshness(null, true)).toBe('not_reported')
  })

  it('blocks new entries on amber data', () => {
    const result = authorizeMarketAction({
      action: 'entry',
      freshnessClass: 'amber',
      integrityState: 'healthy',
      sequenceState: 'continuous',
      heartbeatState: 'healthy',
      priceOrigin: 'live',
      secondaryConfirmed: true,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('STALE_MARKET_DATA')
  })

  it('allows protective reduction on amber only with healthy secondary confirmation', () => {
    const denied = authorizeMarketAction({
      action: 'protective_reduction',
      freshnessClass: 'amber',
      integrityState: 'healthy',
      sequenceState: 'continuous',
      heartbeatState: 'healthy',
      priceOrigin: 'live',
      secondaryConfirmed: false,
    })
    const allowed = authorizeMarketAction({
      action: 'protective_reduction',
      freshnessClass: 'amber',
      integrityState: 'healthy',
      sequenceState: 'continuous',
      heartbeatState: 'healthy',
      priceOrigin: 'live',
      secondaryConfirmed: true,
    })
    expect(denied.code).toBe('SECONDARY_CONFIRMATION_REQUIRED')
    expect(allowed.allowed).toBe(true)
  })

  it('never executes cache, static, or request-provided prices', () => {
    for (const priceOrigin of ['cache', 'static', 'request'] as const) {
      const result = authorizeMarketAction({
        action: 'entry',
        freshnessClass: 'green',
        integrityState: 'healthy',
        sequenceState: 'continuous',
        heartbeatState: 'healthy',
        priceOrigin,
        secondaryConfirmed: true,
      })
      expect(result.allowed).toBe(false)
      expect(result.code).toBe('NON_EXECUTABLE_PRICE')
    }
  })

  it('requires explicit stricter approval for scale-in', () => {
    const result = authorizeMarketAction({
      action: 'scale_in',
      freshnessClass: 'green',
      integrityState: 'healthy',
      sequenceState: 'continuous',
      heartbeatState: 'healthy',
      priceOrigin: 'live',
      secondaryConfirmed: true,
      stricterRiskApproved: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('INVALID_RISK_DECISION')
  })
})
