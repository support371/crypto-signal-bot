/**
 * Bitget UTA (Unified Trading Account) V3 read-only endpoints.
 *
 * Read-only enforcement is structural: the allowlist below is a frozen const
 * containing GET endpoints only. `assertBitgetV3ReadOnlyRequest` throws for any
 * non-GET method or any path outside the list, so no code path in this module
 * can construct a write request.
 *
 * Origin pin: https://api.bitget.com — the documented regular UTA REST domain.
 * DEVIATION from the step-1 plan (documented, correctness fix): the plan pinned
 * https://vip-api-uta-a.bitget.com, which is the Lo-La VIP-only domain. Regular
 * (non-VIP) accounts must use https://api.bitget.com per the UTA endpoint docs.
 *
 * DEVIATION from the step-1 plan (documented, correctness fix): the instruments
 * endpoint is GET /api/v3/market/instruments (per UTA docs, requires `category`),
 * not /api/v3/public/instruments.
 */

export const BITGET_V3_API_ORIGIN = 'https://api.bitget.com'

export const BITGET_V3_ENDPOINTS = Object.freeze({
  accountAssets: '/api/v3/account/assets',
  accountSettings: '/api/v3/account/settings',
  fundingAssets: '/api/v3/account/funding-assets',
  currentPositions: '/api/v3/position/current-position',
  instruments: '/api/v3/market/instruments',
} as const)

export type BitgetV3ReadOnlyEndpoint =
  (typeof BITGET_V3_ENDPOINTS)[keyof typeof BITGET_V3_ENDPOINTS]

const PRIVATE_V3_READ_PATHS = new Set<BitgetV3ReadOnlyEndpoint>([
  BITGET_V3_ENDPOINTS.accountAssets,
  BITGET_V3_ENDPOINTS.accountSettings,
  BITGET_V3_ENDPOINTS.fundingAssets,
  BITGET_V3_ENDPOINTS.currentPositions,
])

export const BITGET_V3_CATEGORIES = Object.freeze([
  'SPOT',
  'MARGIN',
  'USDT-FUTURES',
  'COIN-FUTURES',
  'USDC-FUTURES',
] as const)

export type BitgetV3Category = (typeof BITGET_V3_CATEGORIES)[number]

export const BITGET_V3_POSITION_SIDES = Object.freeze(['long', 'short'] as const)

export type BitgetV3PositionSide = (typeof BITGET_V3_POSITION_SIDES)[number]

export function normalizeBitgetV3Symbol(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/-/g, '')
  if (!/^[A-Z0-9]{4,40}$/.test(normalized)) {
    throw new TypeError('Bitget V3 symbol must be 4-40 uppercase alphanumeric characters')
  }
  return normalized
}

export function assertBitgetV3Category(value: unknown): BitgetV3Category {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!(BITGET_V3_CATEGORIES as readonly string[]).includes(normalized)) {
    throw new TypeError(
      `Bitget V3 category must be one of ${BITGET_V3_CATEGORIES.join(', ')}`,
    )
  }
  return normalized as BitgetV3Category
}

export function assertBitgetV3PositionSide(value: unknown): BitgetV3PositionSide {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!(BITGET_V3_POSITION_SIDES as readonly string[]).includes(normalized)) {
    throw new TypeError('Bitget V3 position side must be long or short')
  }
  return normalized as BitgetV3PositionSide
}

export function isBitgetV3PrivateReadEndpoint(
  path: string,
): path is BitgetV3ReadOnlyEndpoint {
  return PRIVATE_V3_READ_PATHS.has(path as BitgetV3ReadOnlyEndpoint)
}

/**
 * Structural read-only gate: only GET, only allowlisted paths.
 * There is intentionally no code path anywhere in this module that can
 * construct a POST/PUT/DELETE request.
 */
export function assertBitgetV3ReadOnlyRequest(
  method: string,
  path: string,
): BitgetV3ReadOnlyEndpoint {
  if (method.trim().toUpperCase() !== 'GET') {
    throw new TypeError('Bitget V3 read-only requests must use GET')
  }
  const allowed = Object.values(BITGET_V3_ENDPOINTS) as readonly string[]
  if (!allowed.includes(path)) {
    throw new TypeError(`Bitget V3 endpoint is not in the read-only allowlist: ${path}`)
  }
  return path as BitgetV3ReadOnlyEndpoint
}

export function buildBitgetV3Query(
  input: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(input).sort()) {
    const value = input[key]
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }
  return params.toString()
}
