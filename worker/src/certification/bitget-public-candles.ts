import {
  asDecimalString,
  compareDecimal,
  type DecimalString,
} from '../live/decimal.ts'
import { sha256Hex } from '../live/operator-read-auth.ts'

const BITGET_PUBLIC_ORIGIN = 'https://api.bitget.com'
const SPOT_CANDLES_PATH = '/api/v2/spot/market/candles'
const FIVE_MINUTES_MS = 5 * 60 * 1000
const MAX_CANDLES = 100
const MAX_RESPONSE_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 4_000

export type CertificationCandle = Readonly<{
  startMs: number
  open: DecimalString
  high: DecimalString
  low: DecimalString
  close: DecimalString
  baseVolume: DecimalString
  quoteVolume: DecimalString
}>

export type BitgetPublicCandleSnapshot = Readonly<{
  provider: 'BITGET'
  productSymbol: string
  granularity: '5min'
  observedAtMs: number
  latestClosedAtMs: number
  candles: readonly CertificationCandle[]
  sourceHash: string
  publicReadOnly: true
  credentialsUsed: false
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
}>

export type BitgetPublicCandleDependencies = Readonly<{
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
  maxResponseBytes?: number
}>

type BitgetCandleEnvelope = {
  code?: unknown
  msg?: unknown
  requestTime?: unknown
  data?: unknown
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,16}USDT$/.test(symbol)) {
    throw new TypeError('productSymbol must be an uppercase USDT spot symbol')
  }
  return symbol
}

function integer(value: unknown, field: string): number {
  const normalized = String(value ?? '').trim()
  if (!/^\d+$/.test(normalized)) throw new TypeError(`${field} must be an integer string`)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`)
  }
  return parsed
}

function parseCandle(value: unknown, index: number): CertificationCandle {
  if (!Array.isArray(value) || value.length < 7) {
    throw new TypeError(`candle[${index}] must contain at least seven fields`)
  }
  const candle = Object.freeze({
    startMs: integer(value[0], `candle[${index}].startMs`),
    open: asDecimalString(value[1], `candle[${index}].open`),
    high: asDecimalString(value[2], `candle[${index}].high`),
    low: asDecimalString(value[3], `candle[${index}].low`),
    close: asDecimalString(value[4], `candle[${index}].close`),
    baseVolume: asDecimalString(value[5], `candle[${index}].baseVolume`),
    quoteVolume: asDecimalString(value[6], `candle[${index}].quoteVolume`),
  })
  if (compareDecimal(candle.low, candle.high) > 0) {
    throw new RangeError(`candle[${index}] low cannot exceed high`)
  }
  for (const [field, price] of [['open', candle.open], ['close', candle.close]] as const) {
    if (compareDecimal(price, candle.low) < 0 || compareDecimal(price, candle.high) > 0) {
      throw new RangeError(`candle[${index}].${field} must be within low and high`)
    }
  }
  return candle
}

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const declared = response.headers.get('Content-Length')
  if (declared && Number(declared) > maximum) {
    throw new RangeError('Bitget candle response exceeds the byte limit')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > maximum) {
      await reader.cancel('response byte limit exceeded')
      throw new RangeError('Bitget candle response exceeds the byte limit')
    }
    chunks.push(next.value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function canonicalSource(candles: readonly CertificationCandle[]): string {
  return JSON.stringify(candles.map((candle) => [
    String(candle.startMs),
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.baseVolume,
    candle.quoteVolume,
  ]))
}

export async function hashBitgetCertificationCandles(
  candles: readonly CertificationCandle[],
): Promise<string> {
  return sha256Hex(canonicalSource(candles))
}

export async function fetchBitgetPublicClosedCandles(
  productSymbol: string,
  dependencies: BitgetPublicCandleDependencies = {},
): Promise<BitgetPublicCandleSnapshot> {
  const symbol = normalizeSymbol(productSymbol)
  const now = dependencies.now?.() ?? Date.now()
  if (!Number.isSafeInteger(now) || now <= 0) throw new RangeError('trusted clock is invalid')
  const timeoutMs = dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS
  const maxResponseBytes = dependencies.maxResponseBytes ?? MAX_RESPONSE_BYTES
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new RangeError('timeoutMs must be between 100 and 10000')
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw new RangeError(`maxResponseBytes must be between 1024 and ${MAX_RESPONSE_BYTES}`)
  }

  const closedBoundary = Math.floor(now / FIVE_MINUTES_MS) * FIVE_MINUTES_MS
  const url = new URL(SPOT_CANDLES_PATH, BITGET_PUBLIC_ORIGIN)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('granularity', '5min')
  url.searchParams.set('endTime', String(closedBoundary - 1))
  url.searchParams.set('limit', String(MAX_CANDLES))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('Bitget candle request timed out'), timeoutMs)
  let response: Response
  try {
    response = await (dependencies.fetcher ?? fetch)(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`Bitget public candles returned HTTP ${response.status}`)

  const body = await readBoundedBody(response, maxResponseBytes)
  let envelope: BitgetCandleEnvelope
  try {
    envelope = JSON.parse(body) as BitgetCandleEnvelope
  } catch {
    throw new TypeError('Bitget public candles returned invalid JSON')
  }
  if (envelope.code !== '00000' || !Array.isArray(envelope.data)) {
    throw new Error('Bitget public candles returned a non-success envelope')
  }
  if (envelope.data.length < 35 || envelope.data.length > MAX_CANDLES) {
    throw new RangeError('Bitget public candles must contain between 35 and 100 records')
  }

  const candles = envelope.data
    .map(parseCandle)
    .filter((candle) => candle.startMs + FIVE_MINUTES_MS <= closedBoundary)
    .sort((left, right) => left.startMs - right.startMs)
  if (candles.length < 35) throw new RangeError('At least 35 closed candles are required')
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index]!.startMs <= candles[index - 1]!.startMs) {
      throw new Error('Bitget public candles contain duplicate timestamps')
    }
  }

  const immutableCandles = Object.freeze(candles.map((candle) => Object.freeze(candle)))
  const latest = immutableCandles.at(-1)!
  const sourceHash = await hashBitgetCertificationCandles(immutableCandles)
  return Object.freeze({
    provider: 'BITGET',
    productSymbol: symbol,
    granularity: '5min',
    observedAtMs: now,
    latestClosedAtMs: latest.startMs + FIVE_MINUTES_MS,
    candles: immutableCandles,
    sourceHash,
    publicReadOnly: true,
    credentialsUsed: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
  })
}
