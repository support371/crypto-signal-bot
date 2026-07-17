import {
  BITGET_API_ORIGIN,
  BITGET_SPOT_ENDPOINTS,
  assertBitgetReadOnlyRequest,
  buildBitgetQuery,
  isBitgetPrivateReadEndpoint,
  type BitgetReadOnlyEndpoint,
} from './endpoints.ts'

export interface BitgetSecretMaterial {
  apiKey: string
  secretKey: string
  passphrase: string
}

export interface BitgetSecretProvider {
  read(): Promise<BitgetSecretMaterial>
}

export interface BitgetReadOnlyClientOptions {
  secretProvider: BitgetSecretProvider
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
  maxResponseBytes?: number
}

export interface BitgetAccountPermissions {
  userId: string
  authorities: readonly string[]
  readOnly: boolean
}

const WRITE_AUTHORITIES = new Set([
  'coow',
  'cpow',
  'stow',
  'smow',
  'ttow',
  'wtow',
  'wwow',
  'chow',
  'p2p',
  'pllw',
  'taxw',
])

const PRIVATE_LIMIT_MAX = 100
const MAX_QUERY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

export class BitgetReadOnlyClientError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'BitgetReadOnlyClientError'
    this.code = code
    this.status = status
  }
}

function requiredSecret(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new BitgetReadOnlyClientError('SECRET_UNAVAILABLE', `${field} is unavailable`)
  return normalized
}

function base64(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function buildBitgetPrehash(
  timestamp: string,
  method: 'GET',
  path: string,
  query: string,
): string {
  return `${timestamp}${method}${path}${query ? `?${query}` : ''}`
}

export async function signBitgetPrehash(secretKey: string, prehash: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requiredSecret(secretKey, 'secretKey')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(prehash)))
}

function validateQuery(query: Readonly<Record<string, string | number | boolean | null | undefined>>): void {
  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > PRIVATE_LIMIT_MAX) {
      throw new BitgetReadOnlyClientError('QUERY_LIMIT_INVALID', `limit must be 1-${PRIVATE_LIMIT_MAX}`)
    }
  }

  const startTime = query.startTime === undefined || query.startTime === null || query.startTime === ''
    ? null
    : Number(query.startTime)
  const endTime = query.endTime === undefined || query.endTime === null || query.endTime === ''
    ? null
    : Number(query.endTime)
  if ((startTime === null) !== (endTime === null)) {
    throw new BitgetReadOnlyClientError('QUERY_TIME_RANGE_INCOMPLETE', 'startTime and endTime must be provided together')
  }
  if (startTime !== null && endTime !== null) {
    if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || startTime >= endTime) {
      throw new BitgetReadOnlyClientError('QUERY_TIME_RANGE_INVALID', 'startTime and endTime must be increasing Unix milliseconds')
    }
    if (endTime - startTime > MAX_QUERY_WINDOW_MS) {
      throw new BitgetReadOnlyClientError('QUERY_TIME_RANGE_TOO_LARGE', 'query time range must not exceed 90 days')
    }
  }
}

function normalizeAuthorities(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new BitgetReadOnlyClientError('PERMISSIONS_MALFORMED', 'Bitget authorities must be an array')
  }
  return Object.freeze(value.map((authority) => String(authority).trim().toLowerCase()).filter(Boolean))
}

export function assertBitgetReadOnlyAuthorities(input: unknown): BitgetAccountPermissions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BitgetReadOnlyClientError('ACCOUNT_INFO_MALFORMED', 'Bitget account info must be an object')
  }
  const root = input as Record<string, unknown>
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root
  const userId = String(data.userId ?? '').trim()
  if (!userId) throw new BitgetReadOnlyClientError('ACCOUNT_ID_MISSING', 'Bitget userId is missing')
  const authorities = normalizeAuthorities(data.authorities)
  const forbidden = authorities.filter((authority) => WRITE_AUTHORITIES.has(authority))
  if (forbidden.length > 0) {
    throw new BitgetReadOnlyClientError(
      'WRITE_PERMISSION_PRESENT',
      `Bitget key has forbidden write permissions: ${forbidden.join(', ')}`,
    )
  }
  return Object.freeze({ userId, authorities, readOnly: true })
}

function parseBitgetEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BitgetReadOnlyClientError('RESPONSE_MALFORMED', 'Bitget response must be an object')
  }
  const envelope = value as Record<string, unknown>
  const code = String(envelope.code ?? '').trim()
  if (code && code !== '00000') {
    const message = String(envelope.msg ?? envelope.message ?? 'Bitget request failed').trim()
    throw new BitgetReadOnlyClientError('BITGET_API_ERROR', `${code}: ${message}`)
  }
  return value
}

export class BitgetReadOnlyClient {
  private readonly secretProvider: BitgetSecretProvider
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(options: BitgetReadOnlyClientOptions) {
    this.secretProvider = options.secretProvider
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      throw new BitgetReadOnlyClientError('TIMEOUT_INVALID', 'timeoutMs must be 100-30000')
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1_024 || this.maxResponseBytes > 5_000_000) {
      throw new BitgetReadOnlyClientError('RESPONSE_LIMIT_INVALID', 'maxResponseBytes must be 1024-5000000')
    }
  }

  async request(
    endpoint: BitgetReadOnlyEndpoint,
    query: Readonly<Record<string, string | number | boolean | null | undefined>> = {},
  ): Promise<unknown> {
    assertBitgetReadOnlyRequest('GET', endpoint)
    validateQuery(query)
    const queryString = buildBitgetQuery(query)
    const url = new URL(endpoint, BITGET_API_ORIGIN)
    if (url.origin !== BITGET_API_ORIGIN || url.pathname !== endpoint) {
      throw new BitgetReadOnlyClientError('ORIGIN_INVALID', 'Bitget request origin or path is invalid')
    }
    url.search = queryString

    const headers = new Headers({
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      locale: 'en-US',
    })

    if (isBitgetPrivateReadEndpoint(endpoint)) {
      const secrets = await this.secretProvider.read()
      const apiKey = requiredSecret(secrets.apiKey, 'apiKey')
      const passphrase = requiredSecret(secrets.passphrase, 'passphrase')
      const timestamp = String(this.now())
      if (!/^\d{13}$/.test(timestamp)) {
        throw new BitgetReadOnlyClientError('CLOCK_INVALID', 'Bitget signing clock must return Unix milliseconds')
      }
      const signature = await signBitgetPrehash(
        secrets.secretKey,
        buildBitgetPrehash(timestamp, 'GET', endpoint, queryString),
      )
      headers.set('ACCESS-KEY', apiKey)
      headers.set('ACCESS-SIGN', signature)
      headers.set('ACCESS-TIMESTAMP', timestamp)
      headers.set('ACCESS-PASSPHRASE', passphrase)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(url.toString(), {
        method: 'GET',
        headers,
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new BitgetReadOnlyClientError('HTTP_ERROR', `Bitget HTTP ${response.status}`, response.status)
      }
      const contentLength = response.headers.get('content-length')
      if (contentLength && Number(contentLength) > this.maxResponseBytes) {
        throw new BitgetReadOnlyClientError('RESPONSE_TOO_LARGE', 'Bitget response exceeds configured size limit')
      }
      const body = await response.text()
      if (new TextEncoder().encode(body).byteLength > this.maxResponseBytes) {
        throw new BitgetReadOnlyClientError('RESPONSE_TOO_LARGE', 'Bitget response exceeds configured size limit')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(body) as unknown
      } catch {
        throw new BitgetReadOnlyClientError('RESPONSE_NOT_JSON', 'Bitget response is not valid JSON')
      }
      return parseBitgetEnvelope(parsed)
    } catch (error) {
      if (error instanceof BitgetReadOnlyClientError) throw error
      if (controller.signal.aborted) {
        throw new BitgetReadOnlyClientError('TIMEOUT', 'Bitget read-only request timed out')
      }
      throw new BitgetReadOnlyClientError('NETWORK_ERROR', 'Bitget read-only request failed')
    } finally {
      clearTimeout(timer)
    }
  }

  async verifyReadOnlyPermissions(): Promise<BitgetAccountPermissions> {
    return assertBitgetReadOnlyAuthorities(await this.request(BITGET_SPOT_ENDPOINTS.accountInfo))
  }

  listAccountAssets(coin?: string): Promise<unknown> {
    return this.request(BITGET_SPOT_ENDPOINTS.accountAssets, coin ? { coin: coin.trim().toUpperCase() } : {})
  }

  listCurrentOrders(query: Readonly<Record<string, string | number | null | undefined>> = {}): Promise<unknown> {
    return this.request(BITGET_SPOT_ENDPOINTS.currentOrders, query)
  }

  listHistoryOrders(query: Readonly<Record<string, string | number | null | undefined>> = {}): Promise<unknown> {
    return this.request(BITGET_SPOT_ENDPOINTS.historyOrders, query)
  }

  listFills(query: Readonly<Record<string, string | number | null | undefined>> = {}): Promise<unknown> {
    return this.request(BITGET_SPOT_ENDPOINTS.fills, query)
  }
}
