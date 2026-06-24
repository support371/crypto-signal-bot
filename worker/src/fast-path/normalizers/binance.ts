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

function parseLevels(value: unknown, side: BookUpdate['side']): BookUpdate[] {
  if (!Array.isArray(value)) return []
  const updates: BookUpdate[] = []
  for (const level of value) {
    if (!Array.isArray(level) || level.length < 2) continue
    const price = positiveNumber(level[0])
    const quantity = positiveNumber(level[1])
    if (price === undefined || quantity === undefined) continue
    updates.push({ side, price, quantity })
  }
  return updates
}

function messageKind(eventType: string, root: JsonRecord): MarketEventKind {
  if (eventType === 'depthUpdate') return 'level2'
  if (eventType === 'bookTicker' || root.b !== undefined || root.a !== undefined) return 'book_ticker'
  if (eventType === 'trade' || eventType === 'aggTrade') return 'trade'
  if (root.lastUpdateId !== undefined) return 'snapshot'
  return 'book_ticker'
}

export function normalizeBinanceMessage(
  payload: unknown,
  receivedTsMs = Date.now(),
  symbolHint?: string,
): NormalizedMarketEvent[] {
  const root = asRecord(payload)
  const eventType = String(root.e ?? root.eventType ?? '').trim()
  const kind = messageKind(eventType, root)
  const symbolRaw = root.s ?? root.symbol ?? symbolHint ?? 'UNKNOWN-USDT'
  const symbol = normalizeMarketSymbol(symbolRaw, 'USDT')
  const exchangeTsMs = parseTimestampMs(root.E ?? root.T ?? root.eventTime ?? root.timestamp, receivedTsMs)
  const sequenceStart = sequenceNumber(root.U ?? root.firstUpdateId ?? root.lastUpdateId ?? root.u)
  const sequenceEnd = sequenceNumber(root.u ?? root.finalUpdateId ?? root.lastUpdateId ?? root.U)
  const updates = [
    ...parseLevels(root.b ?? root.bids, 'bid'),
    ...parseLevels(root.a ?? root.asks, 'ask'),
  ]

  const directBid = positiveNumber(root.b)
  const directAsk = positiveNumber(root.a)
  const bidUpdates = updates.filter((update) => update.side === 'bid' && update.quantity > 0)
  const askUpdates = updates.filter((update) => update.side === 'ask' && update.quantity > 0)
  const channel = kind === 'level2'
    ? 'diff_depth'
    : kind === 'snapshot'
      ? 'depth_snapshot'
      : kind === 'trade'
        ? 'trades'
        : 'book_ticker'

  const base: Omit<NormalizedMarketEvent, 'eventId'> = {
    version: '2.0',
    source: 'binance',
    channel,
    kind,
    symbol,
    exchangeTsMs,
    receivedTsMs,
    sequenceStart,
    sequenceEnd,
    bid: directBid ?? (bidUpdates.length ? Math.max(...bidUpdates.map((update) => update.price)) : undefined),
    ask: directAsk ?? (askUpdates.length ? Math.min(...askUpdates.map((update) => update.price)) : undefined),
    updates: updates.length ? updates : undefined,
    rawDigest: `binance:${channel}:${sequenceStart ?? exchangeTsMs}:${sequenceEnd ?? exchangeTsMs}`,
  }

  return [{ ...base, eventId: buildMarketEventId(base) }]
}
