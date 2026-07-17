export type DecimalString = string & { readonly __decimalString: unique symbol }
export type SignedDecimalString = string & { readonly __signedDecimalString: unique symbol }

const UNSIGNED_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/
const SIGNED_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/
const MAX_DIVISION_SCALE = 36

interface ParsedDecimal {
  coefficient: bigint
  scale: number
}

function parse(value: unknown, signed: boolean, field: string): ParsedDecimal {
  const normalized = String(value ?? '').trim()
  const pattern = signed ? SIGNED_PATTERN : UNSIGNED_PATTERN
  if (!pattern.test(normalized)) {
    const kind = signed ? 'signed' : 'non-negative'
    throw new TypeError(`${field} must be a ${kind} base-10 decimal string`)
  }

  const negative = normalized.startsWith('-')
  const unsigned = negative ? normalized.slice(1) : normalized
  const [whole, fraction = ''] = unsigned.split('.')
  const digits = `${whole}${fraction}`
  const coefficient = BigInt(digits || '0') * (negative ? -1n : 1n)
  return normalizeParsed({ coefficient, scale: fraction.length })
}

function normalizeParsed(value: ParsedDecimal): ParsedDecimal {
  let { coefficient, scale } = value
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 }

  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  return { coefficient, scale }
}

function powerOfTen(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError('scale must be a non-negative integer')
  }
  return 10n ** BigInt(scale)
}

function validateDivisionScale(scale: number): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DIVISION_SCALE) {
    throw new RangeError(`division scale must be an integer from 0 to ${MAX_DIVISION_SCALE}`)
  }
  return scale
}

function align(left: ParsedDecimal, right: ParsedDecimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale)
  return [
    left.coefficient * powerOfTen(scale - left.scale),
    right.coefficient * powerOfTen(scale - right.scale),
    scale,
  ]
}

function formatParsed(value: ParsedDecimal): string {
  const normalized = normalizeParsed(value)
  const negative = normalized.coefficient < 0n
  const absolute = negative ? -normalized.coefficient : normalized.coefficient
  const digits = absolute.toString()

  if (normalized.scale === 0) {
    return `${negative ? '-' : ''}${digits}`
  }

  const padded = digits.padStart(normalized.scale + 1, '0')
  const splitAt = padded.length - normalized.scale
  const formatted = `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`
  return `${negative ? '-' : ''}${formatted}`
}

export function asDecimalString(value: unknown, field = 'value'): DecimalString {
  const parsed = parse(value, false, field)
  return formatParsed(parsed) as DecimalString
}

export function asSignedDecimalString(value: unknown, field = 'value'): SignedDecimalString {
  const parsed = parse(value, true, field)
  return formatParsed(parsed) as SignedDecimalString
}

export function compareDecimal(left: DecimalString, right: DecimalString): -1 | 0 | 1 {
  const [a, b] = align(parse(left, false, 'left'), parse(right, false, 'right'))
  return a < b ? -1 : a > b ? 1 : 0
}

export function addDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const [a, b, scale] = align(parse(left, false, 'left'), parse(right, false, 'right'))
  return formatParsed({ coefficient: a + b, scale }) as DecimalString
}

export function subtractDecimal(
  left: DecimalString,
  right: DecimalString,
): SignedDecimalString {
  const [a, b, scale] = align(parse(left, false, 'left'), parse(right, false, 'right'))
  return formatParsed({ coefficient: a - b, scale }) as SignedDecimalString
}

export function subtractNonNegativeDecimal(
  left: DecimalString,
  right: DecimalString,
  field = 'result',
): DecimalString {
  const [a, b, scale] = align(parse(left, false, 'left'), parse(right, false, 'right'))
  if (a < b) throw new RangeError(`${field} cannot be negative`)
  return formatParsed({ coefficient: a - b, scale }) as DecimalString
}

export function multiplyDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const a = parse(left, false, 'left')
  const b = parse(right, false, 'right')
  return formatParsed({
    coefficient: a.coefficient * b.coefficient,
    scale: a.scale + b.scale,
  }) as DecimalString
}

/**
 * Divide non-negative decimals and round toward zero at the explicit result scale.
 * Financial callers must choose the scale and perform exchange-increment
 * quantization separately; this function never rounds up.
 */
export function divideDecimalDown(
  dividend: DecimalString,
  divisor: DecimalString,
  resultScale: number,
): DecimalString {
  const left = parse(dividend, false, 'dividend')
  const right = parse(divisor, false, 'divisor')
  const scale = validateDivisionScale(resultScale)
  if (right.coefficient <= 0n) throw new RangeError('divisor must be greater than zero')

  const numerator = left.coefficient * powerOfTen(right.scale + scale)
  const denominator = right.coefficient * powerOfTen(left.scale)
  const coefficient = numerator / denominator
  return formatParsed({ coefficient, scale }) as DecimalString
}

export function isPositiveDecimal(value: DecimalString): boolean {
  return parse(value, false, 'value').coefficient > 0n
}

export function assertPositiveDecimal(value: DecimalString, field = 'value'): DecimalString {
  if (!isPositiveDecimal(value)) {
    throw new RangeError(`${field} must be greater than zero`)
  }
  return value
}

export function isIncrementAligned(value: DecimalString, increment: DecimalString): boolean {
  const parsedIncrement = parse(increment, false, 'increment')
  if (parsedIncrement.coefficient <= 0n) {
    throw new RangeError('increment must be greater than zero')
  }

  const [amount, step] = align(parse(value, false, 'value'), parsedIncrement)
  return amount % step === 0n
}

export function quantizeDown(value: DecimalString, increment: DecimalString): DecimalString {
  const parsedIncrement = parse(increment, false, 'increment')
  if (parsedIncrement.coefficient <= 0n) {
    throw new RangeError('increment must be greater than zero')
  }

  const [amount, step, scale] = align(parse(value, false, 'value'), parsedIncrement)
  const quantized = (amount / step) * step
  return formatParsed({ coefficient: quantized, scale }) as DecimalString
}

export function decimalScale(value: DecimalString): number {
  return parse(value, false, 'value').scale
}

export function sumDecimals(values: readonly DecimalString[]): DecimalString {
  return values.reduce<DecimalString>(
    (total, value) => addDecimal(total, value),
    asDecimalString('0'),
  )
}
