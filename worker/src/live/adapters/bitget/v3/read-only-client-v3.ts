/**
 * Bitget UTA V3 read-only client.
 *
 * Safety shape (mirrors the V2 read-only client): origin pinning, GET-only
 * frozen endpoint allowlist, HMAC-SHA256+base64 signing, envelope validation
 * (code === '00000'), timeouts, response-size caps, and fail-closed permission
 * assertion. There are no POST/PUT/DELETE code paths in this module — it is
 * structurally incapable of placing orders, independent of any flag or config.
 *
 * Signer verification (byte-for-byte, per the step-1 plan §5): Bitget's UTA
 * docs define the signature as
 *   ACCESS-SIGN = base64(HMAC-SHA256(secretKey,
 *     timestamp + method.toUpperCase() + requestPath + ("?" + queryString) + body))
 * with the body omitted for GET. The UTA GET example
 *   16273667805456 + GET + /api/v3/account/fee-rate + ?category=SPOT&symbol=BTCUSDT
 *   => '16273667805456GET/api/v3/account/fee-rate?category=SPOT&symbol=BTCUSDT'
 * is exactly what `buildBitgetPrehash(timestamp, 'GET', path, query)` from the
 * V2 module produces, and `signBitgetPrehash` applies the same HMAC-SHA256 +
 * base64 construction. The V2 signer is therefore reused. A known-answer test
 * encoding the documented example lives in the endpoint tests.
 *
 * Permission model (documented limitation): no V3 endpoint exposes the API key's
 * permission scopes (verified against the UTA docs 2026-10-05 — `account/settings`
 * returns uid/accountMode/holdMode but no authorities array). Accordingly,
 * `assertBitgetV3ReadOnlyAuthorities` verifies what the API does expose:
 * a well-formed settings payload for a UNIFIED-mode account. Write-scope safety
 * is enforced structurally (GET-only allowlist; zero write code paths), so a
 * key carrying write scopes gains no additional capability through this client.
 */
import {
  buildBitgetPrehash,
  signBitgetPrehash,
} from '../read-only-client.ts'
import {
  BITGET_V3_API_ORIGIN,
  BITGET_V3_ENDPOINTS,
  assertBitgetV3Category,
  assertBitgetV3PositionSide,
  assertBitgetV3ReadOnlyRequest,
  buildBitgetV3Query,
  isBitgetV3PrivateReadEndpoint,
  normalizeBitgetV3Symbol,
  type BitgetV3Category,
  type BitgetV3PositionSide,
  type BitgetV3ReadOnlyEndpoint,
} from './endpoints-v3.ts'

export interface BitgetV3SecretMaterial {
  apiKey: string
  secretKey: string
  passphrase: string
}

export interface BitgetV3SecretProvider {
  read(): Promise<BitgetV3SecretMaterial>
}

export interface BitgetV3ReadOnlyClientOptions {
  secretProvider: BitgetV3SecretProvider
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
  maxResponseBytes?: number
}

export interface BitgetV3AccountPermissions {
  userId: string
  accountMode: 'unified'
  readOnly: true
}

const PRIVATE_LIMIT_MAX = 100

export class BitgetV3ReadOnlyClientError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'BitgetV3ReadOnlyClientError'
    this.code = code
    this.status = status
  }
}

function requiredSecret(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new BitgetV3ReadOnlyClientError('SECRET_UNAVAILABLE', `${field} is unavailable`)
  }
  return normalized
}

/**
 * Fail-closed permission assertion for the V3 read-only client.
 *
 * Verifies (from GET /api/v3/account/settings):
 * - the payload is a well-formed object with a `data` section,
 * - `data.uid` is a non-empty string,
 * - `data.accountMode` is exactly 'unified' — the V3 client must never run
 *   against a classic/hybrid/upgrading/switching account.
 *
 * It does NOT enumerate the API key's permission scopes: no V3 endpoint exposes
 * them. A key with write scopes is safe here only because this module contains
 * no write code paths (GET-only frozen allowlist).
 */
export function assertBitgetV3ReadOnlyAuthorities(
  input: unknown,
): BitgetV3AccountPermissions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BitgetV3ReadOnlyClientError(
      'ACCOUNT_SETTINGS_MALFORMED',
      'Bitget V3 account settings must be an object',
    )
  }
  const root = input as Record<string, unknown>
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? (root.data as Record<string, unknown>)
    : root
  const userId = String(data.uid ?? data.userId ?? '').trim()
  if (!userId) {
    throw new BitgetV3ReadOnlyClientError(
      'ACCOUNT_ID_MISSING',
      'Bitget V3 account uid is missing',
    )
  }
  const accountMode = String(data.accountMode ?? '').trim().toLowerCase()
  if (accountMode !== 'unified') {
    throw new BitgetV3ReadOnlyClientError(
      'ACCOUNT_MODE_NOT_UNIFIED',
      `Bitget V3 read-only client requires a unified account (saw '${accountMode || 'missing'}')`,
    )
  }
  return Object.freeze({ userId, accountMode: 'unified', readOnly: true })
}

function parseBitgetV3Envelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BitgetV3ReadOnlyClientError(
      'RESPONSE_MALFORMED',
      'Bitget V3 response must be an object',
    )
  }
  const envelope = value as Record<string, unknown>
  const code = String(envelope.code ?? '').trim()
  if (code && code !== '00000') {
    const message = String(envelope.msg ?? envelope.message ?? 'Bitget V3 request failed').trim()
    throw new BitgetV3ReadOnlyClientError('BITGET_V3_API_ERROR', `${code}: ${message}`)
  }
  return value
}

function validateQuery(
  query: Readonly<Record<string, string | number | boolean | null | undefined>>,
): void {
  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > PRIVATE_LIMIT_MAX) {
      throw new BitgetV3ReadOnlyClientError(
        'QUERY_LIMIT_INVALID',
        `limit must be 1-${PRIVATE_LIMIT_MAX}`,
      )
    }
  }
}

export class BitgetV3ReadOnlyClient {
  private readonly secretProvider: BitgetV3SecretProvider
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(options: BitgetV3ReadOnlyClientOptions) {
    this.secretProvider = options.secretProvider
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      throw new BitgetV3ReadOnlyClientError(
        'TIMEOUT_INVALID',
        'timeoutMs must be 100-30000',
      )
    }
    if (
      !Number.isInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 1_024 ||
      this.maxResponseBytes > 5_000_000
    ) {
      throw new BitgetV3ReadOnlyClientError(
        'RESPONSE_LIMIT_INVALID',
        'maxResponseBytes must be 1024-5000000',
      )
    }
  }

  async request(
    endpoint: BitgetV3ReadOnlyEndpoint,
    query: Readonly<Record<string, string | number | boolean | null | undefined>> = {},
  ): Promise<unknown> {
    assertBitgetV3ReadOnlyRequest('GET', endpoint)
    validateQuery(query)
    const queryString = buildBitgetV3Query(query)
    const url = new URL(endpoint, BITGET_V3_API_ORIGIN)
    if (url.origin !== BITGET_V3_API_ORIGIN || url.pathname !== endpoint) {
      throw new BitgetV3ReadOnlyClientError(
        'ORIGIN_INVALID',
        'Bitget V3 request origin or path is invalid',
      )
    }
    url.search = queryString

    const headers = new Headers({
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      locale: 'en-US',
    })

    if (isBitgetV3PrivateReadEndpoint(endpoint)) {
      const secrets = await this.secretProvider.read()
      const apiKey = requiredSecret(secrets.apiKey, 'apiKey')
      const passphrase = requiredSecret(secrets.passphrase, 'passphrase')
      const timestamp = String(this.now())
      if (!/^\d{13}$/.test(timestamp)) {
        throw new BitgetV3ReadOnlyClientError(
          'CLOCK_INVALID',
          'Bitget V3 signing clock must return Unix milliseconds',
        )
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
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new BitgetV3ReadOnlyClientError(
          'HTTP_ERROR',
          `Bitget V3 HTTP ${response.status}`,
          response.status,
        )
      }
      const contentLength = response.headers.get('content-length')
      if (contentLength && Number(contentLength) > this.maxResponseBytes) {
        throw new BitgetV3ReadOnlyClientError(
          'RESPONSE_TOO_LARGE',
          'Bitget V3 response exceeds configured size limit',
        )
      }
      const body = await response.text()
      if (new TextEncoder().encode(body).byteLength > this.maxResponseBytes) {
        throw new BitgetV3ReadOnlyClientError(
          'RESPONSE_TOO_LARGE',
          'Bitget V3 response exceeds configured size limit',
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(body) as unknown
      } catch {
        throw new BitgetV3ReadOnlyClientError(
          'RESPONSE_NOT_JSON',
          'Bitget V3 response is not valid JSON',
        )
      }
      return parseBitgetV3Envelope(parsed)
    } catch (error) {
      if (error instanceof BitgetV3ReadOnlyClientError) throw error
      if (controller.signal.aborted) {
        throw new BitgetV3ReadOnlyClientError(
          'TIMEOUT',
          'Bitget V3 read-only request timed out',
        )
      }
      throw new BitgetV3ReadOnlyClientError(
        'NETWORK_ERROR',
        'Bitget V3 read-only request failed',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async verifyReadOnlyPermissions(): Promise<BitgetV3AccountPermissions> {
    return assertBitgetV3ReadOnlyAuthorities(
      await this.request(BITGET_V3_ENDPOINTS.accountSettings),
    )
  }

  getAccountAssets(): Promise<unknown> {
    return this.request(BITGET_V3_ENDPOINTS.accountAssets)
  }

  getAccountSettings(): Promise<unknown> {
    return this.request(BITGET_V3_ENDPOINTS.accountSettings)
  }

  async getFundingAssets(coin?: string): Promise<unknown> {
    const normalized = coin === undefined ? undefined : coin.trim().toUpperCase()
    if (normalized !== undefined && !/^[A-Z0-9]{2,20}$/.test(normalized)) {
      throw new BitgetV3ReadOnlyClientError(
        'COIN_INVALID',
        'coin must be a 2-20 character uppercase asset code',
      )
    }
    return this.request(
      BITGET_V3_ENDPOINTS.fundingAssets,
      normalized ? { coin: normalized } : {},
    )
  }

  async getCurrentPositions(
    query: Readonly<{
      category?: unknown
      symbol?: unknown
      posSide?: unknown
      limit?: unknown
    }> = {},
  ): Promise<unknown> {
    const normalized: Record<string, string | number> = {}
    if (query.category !== undefined && query.category !== null && query.category !== '') {
      normalized.category = assertBitgetV3Category(query.category)
    }
    if (query.symbol !== undefined && query.symbol !== null && query.symbol !== '') {
      normalized.symbol = normalizeBitgetV3Symbol(query.symbol)
    }
    if (query.posSide !== undefined && query.posSide !== null && query.posSide !== '') {
      normalized.posSide = assertBitgetV3PositionSide(query.posSide)
    }
    if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
      normalized.limit = query.limit as string | number
    }
    return this.request(BITGET_V3_ENDPOINTS.currentPositions, normalized)
  }

  async getInstruments(category: unknown): Promise<unknown> {
    return this.request(BITGET_V3_ENDPOINTS.instruments, {
      category: assertBitgetV3Category(category),
    })
  }
}

export type {
  BitgetV3Category,
  BitgetV3PositionSide,
  BitgetV3ReadOnlyEndpoint,
}
