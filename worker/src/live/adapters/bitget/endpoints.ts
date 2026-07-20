export const BITGET_API_ORIGIN = 'https://api.bitget.com'

export const BITGET_SPOT_ENDPOINTS = Object.freeze({
  symbols: '/api/v2/spot/public/symbols',
  tickers: '/api/v2/spot/market/tickers',
  accountInfo: '/api/v2/spot/account/info',
  accountAssets: '/api/v2/spot/account/assets',
  currentOrders: '/api/v2/spot/trade/unfilled-orders',
  historyOrders: '/api/v2/spot/trade/history-orders',
  orderInfo: '/api/v2/spot/trade/orderInfo',
  fills: '/api/v2/spot/trade/fills',
} as const)

export type BitgetReadOnlyEndpoint = typeof BITGET_SPOT_ENDPOINTS[keyof typeof BITGET_SPOT_ENDPOINTS]

const PRIVATE_READ_ONLY_PATHS = new Set<BitgetReadOnlyEndpoint>([
  BITGET_SPOT_ENDPOINTS.accountInfo,
  BITGET_SPOT_ENDPOINTS.accountAssets,
  BITGET_SPOT_ENDPOINTS.currentOrders,
  BITGET_SPOT_ENDPOINTS.historyOrders,
  BITGET_SPOT_ENDPOINTS.orderInfo,
  BITGET_SPOT_ENDPOINTS.fills,
])

export function normalizeBitgetSymbol(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase().replace('-', '')
  if (!/^[A-Z0-9]{4,30}$/.test(normalized)) {
    throw new TypeError('Bitget symbol must be 4-30 uppercase alphanumeric characters')
  }
  return normalized
}

export function isBitgetPrivateReadEndpoint(path: string): path is BitgetReadOnlyEndpoint {
  return PRIVATE_READ_ONLY_PATHS.has(path as BitgetReadOnlyEndpoint)
}

export function assertBitgetReadOnlyRequest(method: string, path: string): BitgetReadOnlyEndpoint {
  if (method.trim().toUpperCase() !== 'GET') {
    throw new TypeError('Bitget candidate requests must use GET')
  }

  const allowed = Object.values(BITGET_SPOT_ENDPOINTS) as readonly string[]
  if (!allowed.includes(path)) {
    throw new TypeError(`Bitget endpoint is not in the read-only allowlist: ${path}`)
  }
  return path as BitgetReadOnlyEndpoint
}

export function buildBitgetQuery(
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
