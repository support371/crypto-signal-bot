import {
  addSignedDecimal,
  asDecimalString,
  asSignedDecimalString,
  compareDecimal,
  compareSignedDecimal,
  type DecimalString,
  type SignedDecimalString,
} from '../live/decimal.ts'
import { sha256Hex } from '../live/operator-read-auth.ts'
import {
  hashBitgetCertificationCandles,
  type BitgetPublicCandleSnapshot,
  type CertificationCandle,
} from './bitget-public-candles.ts'

const INDICATOR_SCALE = 12
const MAX_SOURCE_AGE_MS = 10 * 60 * 1000

export type CertificationSignalDirection = 'BUY' | 'SELL' | 'HOLD'

export type CertificationSignalEvidence = Readonly<{
  version: 'certification-signal-v1'
  provider: 'BITGET'
  productSymbol: string
  granularity: '5min'
  direction: CertificationSignalDirection
  confidenceBps: number
  indicators: Readonly<{
    ema12: DecimalString
    ema26: DecimalString
    rsi14Bps: number
    directionalVolumeDelta: SignedDecimalString
    volumeMethod: 'CANDLE_DIRECTION_PROXY'
  }>
  reasons: readonly string[]
  candleCount: number
  latestClosedAtMs: number
  referencePrice: DecimalString
  sourceAgeMs: number
  sourceHash: string
  signalIdentityHash: string
  evidenceHash: string
  requiresIndependentRiskDecision: true
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

type CertificationSignalHashPayload = Omit<CertificationSignalEvidence, 'evidenceHash'>

function scaled(value: DecimalString): bigint {
  const [whole, fraction = ''] = value.split('.')
  const padded = fraction.padEnd(INDICATOR_SCALE, '0').slice(0, INDICATOR_SCALE)
  return BigInt(`${whole}${padded}`)
}

function decimal(value: bigint): DecimalString {
  const digits = value.toString().padStart(INDICATOR_SCALE + 1, '0')
  const split = digits.length - INDICATOR_SCALE
  const raw = `${digits.slice(0, split)}.${digits.slice(split)}`
  return raw.replace(/0+$/, '').replace(/\.$/, '') as DecimalString
}

function ema(values: readonly DecimalString[], period: number): DecimalString {
  if (values.length < period) throw new RangeError(`EMA${period} requires ${period} values`)
  let current = scaled(values[0]!)
  const denominator = BigInt(period + 1)
  const previousWeight = BigInt(period - 1)
  for (let index = 1; index < values.length; index += 1) {
    current = (scaled(values[index]!) * 2n + current * previousWeight) / denominator
  }
  return decimal(current)
}

function rsiBps(values: readonly DecimalString[], period = 14): number {
  if (values.length < period + 1) throw new RangeError(`RSI${period} requires ${period + 1} values`)
  const sample = values.slice(-(period + 1)).map(scaled)
  let gains = 0n
  let losses = 0n
  for (let index = 1; index < sample.length; index += 1) {
    const change = sample[index]! - sample[index - 1]!
    if (change > 0n) gains += change
    if (change < 0n) losses += -change
  }
  if (gains === 0n && losses === 0n) return 5_000
  if (losses === 0n) return 10_000
  return Number((10_000n * gains) / (gains + losses))
}

function directionalVolumeDelta(candles: readonly CertificationCandle[]): SignedDecimalString {
  return candles.slice(-5).reduce<SignedDecimalString>((total, candle) => {
    const direction = compareDecimal(candle.close, candle.open)
    const signed = asSignedDecimalString(
      direction < 0 ? `-${candle.baseVolume}` : direction > 0 ? candle.baseVolume : '0',
      'directionalVolume',
    )
    return addSignedDecimal(total, signed)
  }, asSignedDecimalString('0'))
}

async function validateSnapshot(snapshot: BitgetPublicCandleSnapshot, nowMs: number): Promise<void> {
  if (snapshot.provider !== 'BITGET' || snapshot.granularity !== '5min') {
    throw new TypeError('Only Bitget five-minute certification snapshots are supported')
  }
  if (!snapshot.publicReadOnly || snapshot.credentialsUsed || snapshot.providerMutationAllowed
    || snapshot.executionAllowed || snapshot.realFundsAllowed) {
    throw new Error('Certification snapshot violates the public read-only capability contract')
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < snapshot.latestClosedAtMs) {
    throw new RangeError('trusted evaluation clock is invalid')
  }
  if (nowMs - snapshot.latestClosedAtMs > MAX_SOURCE_AGE_MS) {
    throw new Error('Bitget certification candle snapshot is stale')
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.sourceHash)) {
    throw new TypeError('snapshot sourceHash is invalid')
  }
  if (snapshot.candles.length < 35 || snapshot.candles.length > 100) {
    throw new RangeError('Certification signal requires between 35 and 100 candles')
  }
  const recomputedSourceHash = await hashBitgetCertificationCandles(snapshot.candles)
  if (recomputedSourceHash !== snapshot.sourceHash) {
    throw new Error('Certification candle source hash does not match the candle evidence')
  }
}

function signalHashPayload(
  evidence: CertificationSignalHashPayload | CertificationSignalEvidence,
): CertificationSignalHashPayload {
  return {
    version: evidence.version,
    provider: evidence.provider,
    productSymbol: evidence.productSymbol,
    granularity: evidence.granularity,
    direction: evidence.direction,
    confidenceBps: evidence.confidenceBps,
    indicators: evidence.indicators,
    reasons: evidence.reasons,
    candleCount: evidence.candleCount,
    latestClosedAtMs: evidence.latestClosedAtMs,
    referencePrice: evidence.referencePrice,
    sourceAgeMs: evidence.sourceAgeMs,
    sourceHash: evidence.sourceHash,
    signalIdentityHash: evidence.signalIdentityHash,
    requiresIndependentRiskDecision: evidence.requiresIndependentRiskDecision,
    providerMutationAllowed: evidence.providerMutationAllowed,
    executionAllowed: evidence.executionAllowed,
    realFundsAllowed: evidence.realFundsAllowed,
    mainnetAllowed: evidence.mainnetAllowed,
    withdrawalsAllowed: evidence.withdrawalsAllowed,
  }
}

export async function verifyCertificationSignalEvidence(
  evidence: CertificationSignalEvidence,
  nowMs: number,
): Promise<void> {
  if (evidence.version !== 'certification-signal-v1' || evidence.provider !== 'BITGET') {
    throw new TypeError('Unsupported certification signal evidence')
  }
  if (evidence.direction !== 'BUY' && evidence.direction !== 'SELL' && evidence.direction !== 'HOLD') {
    throw new TypeError('Certification signal direction is invalid')
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < evidence.latestClosedAtMs) {
    throw new RangeError('trusted verification clock is invalid')
  }
  if (nowMs - evidence.latestClosedAtMs > MAX_SOURCE_AGE_MS) {
    throw new Error('Certification signal evidence is stale')
  }
  if (asDecimalString(evidence.referencePrice, 'referencePrice') !== evidence.referencePrice) {
    throw new TypeError('Certification signal referencePrice is not canonical')
  }
  if (evidence.providerMutationAllowed || evidence.executionAllowed || evidence.realFundsAllowed
    || evidence.mainnetAllowed || evidence.withdrawalsAllowed
    || !evidence.requiresIndependentRiskDecision) {
    throw new Error('Certification signal violates its permanent capability locks')
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.evidenceHash)) {
    throw new TypeError('Certification signal evidenceHash is invalid')
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.signalIdentityHash)) {
    throw new TypeError('Certification signal identity hash is invalid')
  }
  const identityHash = await sha256Hex(JSON.stringify({
    version: evidence.version,
    provider: evidence.provider,
    productSymbol: evidence.productSymbol,
    granularity: evidence.granularity,
    latestClosedAtMs: evidence.latestClosedAtMs,
    sourceHash: evidence.sourceHash,
  }))
  if (identityHash !== evidence.signalIdentityHash) {
    throw new Error('Certification signal identity hash does not match its source')
  }
  const recomputed = await sha256Hex(JSON.stringify(signalHashPayload(evidence)))
  if (recomputed !== evidence.evidenceHash) {
    throw new Error('Certification signal evidence hash does not match its payload')
  }
}

export async function evaluateCertificationSignal(
  snapshot: BitgetPublicCandleSnapshot,
  nowMs: number,
): Promise<CertificationSignalEvidence> {
  await validateSnapshot(snapshot, nowMs)
  const closes = snapshot.candles.map((candle) => candle.close)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const rsi14 = rsiBps(closes)
  const volumeDelta = directionalVolumeDelta(snapshot.candles)
  const trend = compareDecimal(ema12, ema26)
  const volumeDirection = compareSignedDecimal(volumeDelta, asSignedDecimalString('0'))

  let direction: CertificationSignalDirection = 'HOLD'
  const reasons: string[] = []
  if (trend > 0 && rsi14 >= 5_200 && rsi14 <= 7_200 && volumeDirection > 0) {
    direction = 'BUY'
    reasons.push('ema12_above_ema26', 'rsi14_supports_uptrend', 'directional_volume_positive')
  } else if (trend < 0 && rsi14 >= 2_800 && rsi14 <= 4_800 && volumeDirection < 0) {
    direction = 'SELL'
    reasons.push('ema12_below_ema26', 'rsi14_supports_downtrend', 'directional_volume_negative')
  } else {
    reasons.push('indicators_not_aligned')
    if (trend === 0) reasons.push('ema_crossover_neutral')
    if (volumeDirection === 0) reasons.push('directional_volume_neutral')
  }

  const confidenceBps = direction === 'HOLD' ? 4_000 : 7_000
  const sourceAgeMs = nowMs - snapshot.latestClosedAtMs
  const referencePrice = snapshot.candles.at(-1)!.close
  const signalIdentityHash = await sha256Hex(JSON.stringify({
    version: 'certification-signal-v1',
    provider: 'BITGET',
    productSymbol: snapshot.productSymbol,
    granularity: '5min',
    latestClosedAtMs: snapshot.latestClosedAtMs,
    sourceHash: snapshot.sourceHash,
  }))
  const evidenceWithoutHash = {
    version: 'certification-signal-v1' as const,
    provider: 'BITGET' as const,
    productSymbol: snapshot.productSymbol,
    granularity: '5min' as const,
    direction,
    confidenceBps,
    indicators: Object.freeze({
      ema12,
      ema26,
      rsi14Bps: rsi14,
      directionalVolumeDelta: volumeDelta,
      volumeMethod: 'CANDLE_DIRECTION_PROXY' as const,
    }),
    reasons: Object.freeze(reasons),
    candleCount: snapshot.candles.length,
    latestClosedAtMs: snapshot.latestClosedAtMs,
    referencePrice,
    sourceAgeMs,
    sourceHash: snapshot.sourceHash,
    signalIdentityHash,
    requiresIndependentRiskDecision: true as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
  }
  return Object.freeze({
    ...evidenceWithoutHash,
    evidenceHash: await sha256Hex(JSON.stringify(evidenceWithoutHash)),
  })
}
