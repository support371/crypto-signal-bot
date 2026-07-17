export const COINBASE_ADVANCED_TRADE_REST_ORIGIN = 'https://api.coinbase.com'
export const COINBASE_ADVANCED_TRADE_REST_PREFIX = '/api/v3/brokerage'
export const COINBASE_MARKET_WS_URL = 'wss://advanced-trade-ws.coinbase.com'
export const COINBASE_USER_WS_URL = 'wss://advanced-trade-ws-user.coinbase.com'

export const COINBASE_ENDPOINTS = Object.freeze({
  accounts: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/accounts`,
  products: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/products`,
  publicProducts: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/market/products`,
  orderPreview: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/orders/preview`,
  createOrder: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/orders`,
  cancelOrders: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/orders/batch_cancel`,
  listOrders: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/orders/historical/batch`,
  listFills: `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/orders/historical/fills`,
} as const)

export function coinbaseProductPath(productId: string, publicMarket = false): string {
  const normalized = productId.trim().toUpperCase()
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(normalized)) {
    throw new TypeError('productId must use BASE-QUOTE format')
  }
  const prefix = publicMarket ? COINBASE_ENDPOINTS.publicProducts : COINBASE_ENDPOINTS.products
  return `${prefix}/${encodeURIComponent(normalized)}`
}

export function coinbaseOrderPath(orderId: string): string {
  const normalized = orderId.trim()
  if (!normalized || normalized.includes('/')) {
    throw new TypeError('orderId must be a non-empty path-safe identifier')
  }
  return `${COINBASE_ADVANCED_TRADE_REST_PREFIX}/orders/historical/${encodeURIComponent(normalized)}`
}
