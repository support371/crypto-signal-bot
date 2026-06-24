import {
  buildMarketEventId,
  normalizeMarketSymbol,
  parseTimestampMs,
  positiveNumber,
  sequenceNumber,
} from '../events'
import type { BookUpdate, MarketEventKind, NormalizedMarketEvent } from '../types'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function updateSide(value: unknown): BookUpdate['side'] | null {
  const side = String(value ?? '').toLowerCase()
  if (side === 'bid' || side === 'buy') return 'bid'
  if (side === 'offer' || side === 'ask' || side === 'sell') return 'ask'
  return null
}

function parseUpdates(value: unknown): BookUpdate[] {
  if (!Array.isArray(value)) return []
  const updates: BookUpdate[] = []
  for (const item of value) {
    const record = asRecord(item)
    const side = updateSide(record.side)
    const price = positiveNumber(record.price_level ?? record.price)
    const quantity = positiveNumber(record.new_quantity ?? record.quantity)
    if (!side || price === undefined || quantity === undefined) continue
    updates.push({ side, price, quantity })
  }
  return updates
}

function eventKind(channel: string, type: string): MarketEventKind {
  if (channel.includes('heartbeat')) return 'heartbeat'
  if (type === 'snapshot') return 'snapshot'
  if (channel.includes('market_trades')) return 'trade'
  return 'level2'
}

export function normalizeCoinbaseMessage(
  payload: unknown,
  receivedTsMs = Date.now(),
): NormalizedMarketEvent[] {
  const root = asRecord(payload)
  const channel = String(root.channel ?? root.type ?? 'unknown')
  const rootSequence = sequenceNumber(root.sequence_num ?? root.sequence)
  const rootExchangeTs = parseTimestampMs(root.timestamp, receivedTsMs)
  const rawEvents = Array.isArray(root.events) && root.events.length > 0 ? root.events : [root]
  const normalized: NormalizedMarketEvent[] = []

  rawEvents.forEach((rawEvent, index) => {
    const record = asRecord(rawEvent)
    const type = String(record.type ?? root.type ?? 'update').toLowerCase()
    const productId = record.product_id ?? record.productId ?? root.product_id ?? '*'
    const symbol = productId === '*' ? '*' : normalizeMarketSymbol(productId)
    const sequence = sequenceNumber(record.sequence_num ?? record.sequence ?? rootSequence)
    const exchangeTsMs = parseTimestampMs(
      record.event_time ?? record.current_time ?? record.timestamp ?? root.timestamp,
      rootExchangeTs,
    )
    const updates = parseUpdates(record.updates)
    const bids = updates.filter((update) => update.side === 'bid' && update.quantity > 0)
    const asks = updates.filter((update) => update.side === 'ask' && update.quantity > 0)
    const base: Omit<NormalizedMarketEvent, 'eventId'> = {
      version: '2.0',
      source: 'coinbase',
      channel,
      kind: eventKind(channel, type),
      symbol,
      exchangeTsMs,
      receivedTsMs,
      sequenceStart: sequence,
      sequenceEnd: sequence,
      bid: bids.length ? Math.max(...bids.map((update) => update.price)) : undefined,
      ask: asks.length ? Math.min(...asks.map((update) => update.price)) : undefined,
      updates: updates.length ? updates : undefined,
      rawDigest: `coinbase:${channel}:${sequence ?? exchangeTsMs}:${index}`,
    }
    normalized.push({ ...base, eventId: buildMarketEventId(base) })
  })

  return normalized
}
