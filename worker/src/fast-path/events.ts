import type { NormalizedMarketEvent, SequenceState } from './types'

export function normalizeMarketSymbol(value: unknown, defaultQuote = 'USD'): string {
  const raw = String(value ?? '').trim().toUpperCase().replace('/', '-')
  if (!raw) return `UNKNOWN-${defaultQuote}`
  if (raw.includes('-')) return raw
  for (const quote of ['USDT', 'USDC', 'USD', 'BTC', 'ETH']) {
    if (raw.endsWith(quote) && raw.length > quote.length) {
      return `${raw.slice(0, -quote.length)}-${quote}`
    }
  }
  return `${raw}-${defaultQuote}`
}

export function parseTimestampMs(value: unknown, fallbackMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallbackMs
}

export function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function sequenceNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

export function buildMarketEventId(event: Omit<NormalizedMarketEvent, 'eventId'>): string {
  const sequence = event.sequenceEnd ?? event.sequenceStart ?? event.exchangeTsMs
  return `${event.source}:${event.channel}:${event.symbol}:${event.kind}:${sequence}`
}

export function validateNormalizedEvent(event: NormalizedMarketEvent): string[] {
  const errors: string[] = []
  if (event.version !== '2.0') errors.push('unsupported_version')
  if (!event.eventId) errors.push('missing_event_id')
  if (!event.channel) errors.push('missing_channel')
  if (!event.symbol) errors.push('missing_symbol')
  if (!Number.isFinite(event.exchangeTsMs) || event.exchangeTsMs <= 0) errors.push('invalid_exchange_timestamp')
  if (!Number.isFinite(event.receivedTsMs) || event.receivedTsMs <= 0) errors.push('invalid_received_timestamp')
  if (event.sequenceStart !== undefined && event.sequenceEnd !== undefined && event.sequenceStart > event.sequenceEnd) {
    errors.push('invalid_sequence_range')
  }
  if (event.bid !== undefined && (!Number.isFinite(event.bid) || event.bid < 0)) errors.push('invalid_bid')
  if (event.ask !== undefined && (!Number.isFinite(event.ask) || event.ask < 0)) errors.push('invalid_ask')
  return errors
}

export function classifySequence(
  lastSequence: number | null,
  sequenceStart?: number,
  sequenceEnd?: number,
): SequenceState {
  if (sequenceStart === undefined && sequenceEnd === undefined) return 'not_reported'
  const start = sequenceStart ?? sequenceEnd as number
  const end = sequenceEnd ?? sequenceStart as number
  if (lastSequence === null) return 'bootstrap'
  if (end === lastSequence) return 'duplicate'
  if (end < lastSequence) return 'out_of_order'
  if (start > lastSequence + 1) return 'gap'
  return 'continuous'
}

export function eventAgeMs(event: Pick<NormalizedMarketEvent, 'exchangeTsMs'>, nowMs: number): number {
  return Math.max(0, nowMs - event.exchangeTsMs)
}

export function isHeartbeatEvent(event: NormalizedMarketEvent): boolean {
  return event.kind === 'heartbeat'
}

export function feedKey(event: Pick<NormalizedMarketEvent, 'source' | 'channel' | 'symbol'>): string {
  return `${event.source}:${event.channel}:${event.symbol}`
}
