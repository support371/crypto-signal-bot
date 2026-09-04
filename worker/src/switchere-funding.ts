import type { AgentContextEnv } from './agent-context'

export type SwitchereFundingEnv = AgentContextEnv & {
  SWITCHERE_PARTNER_KEY?: string
  SWITCHERE_CALLBACK_SECRET?: string
  SWITCHERE_MODE?: string
  SWITCHERE_LIVE_ENABLED?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  FUNDING_MIN_AMOUNT?: string
  FUNDING_MAX_AMOUNT?: string
}

type AuthActor = {
  id: string
  email: string | null
  method: 'operator_api_key' | 'supabase_session'
}

type PreflightRequest = {
  clientReference?: string
  clientEmail?: string
  clientCountry?: string
  payinAmount?: string | number
  payinCurrency?: string
  payoutCurrency?: string
  dstAddress?: string
  memo?: string | number
  returnBaseUrl?: string
  clientApproved?: boolean
  cardholderNameMatch?: boolean
  cardUsePermissionConfirmed?: boolean
}

type CountryRecord = {
  code?: string
  forbidden?: boolean | number | string
  forbidden_card?: boolean | number | string
  name?: string
}

type PaymentGroup = {
  group?: string
  list?: Array<{ currency?: string; is_crypto?: boolean }>
}

type SwitchereCallbackOrder = {
  partner_order_id?: string
  client_order_id?: string
  payin_amount?: string | number
  payout_amount?: string | number
  payin_currency?: string
  payout_currency?: string
  status?: string
  substatus?: string
  error_message?: string
  card_number?: string
  status_log?: Array<{ status?: string; at?: string | number }>
}

const encoder = new TextEncoder()
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const CURRENCY_PATTERN = /^[A-Z0-9]{2,12}$/
const COUNTRY_PATTERN = /^[A-Z]{2}$/
const AMOUNT_PATTERN = /^\d{1,9}(?:\.\d{1,8})?$/
const CARD_SECRET_FIELDS = new Set([
  'cardnumber',
  'card_number',
  'pan',
  'cvv',
  'cvc',
  'cvv2',
  'cvc2',
  'securitycode',
  'security_code',
  'pin',
  'track1',
  'track2',
])

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function allowedOrigins(env: SwitchereFundingEnv): string[] {
  return env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : []
}

function corsHeaders(request: Request, env: SwitchereFundingEnv): Headers {
  const configured = allowedOrigins(env)
  const origin = request.headers.get('Origin') ?? ''
  const allowedOrigin = configured.includes('*')
    ? origin || '*'
    : configured.includes(origin)
      ? origin
      : configured[0] ?? 'null'

  return new Headers({
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  })
}

function jsonResponse(
  request: Request,
  env: SwitchereFundingEnv,
  payload: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, env),
  })
}

function hasCardSecretFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasCardSecretFields)

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[\s-]/g, '').toLowerCase()
    if (CARD_SECRET_FIELDS.has(normalized) || CARD_SECRET_FIELDS.has(key.toLowerCase())) {
      return true
    }
    if (hasCardSecretFields(nested)) return true
  }
  return false
}

async function hashBytes(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value))
}

async function hashHex(value: string): Promise<string> {
  const digest = new Uint8Array(await hashBytes(value))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

export async function buildSwitchereCallbackSignature(
  content: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const contentDigest = await hashBytes(content)
  const signature = await crypto.subtle.sign('HMAC', key, contentDigest)
  return bytesToBase64(new Uint8Array(signature))
}

async function verifyCallbackSignature(
  content: string,
  providedSignature: string,
  secret: string,
): Promise<boolean> {
  const expected = await buildSwitchereCallbackSignature(content, secret)
  return constantTimeEqual(expected, providedSignature.trim())
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`Switchere returned ${response.status}`)
    return await response.json() as T
  } finally {
    clearTimeout(timer)
  }
}

async function authenticateActor(
  request: Request,
  env: SwitchereFundingEnv,
): Promise<AuthActor | null> {
  const operatorKey = request.headers.get('X-API-Key')
  if (env.BACKEND_API_KEY && operatorKey === env.BACKEND_API_KEY) {
    return { id: 'operator-api-key', email: null, method: 'operator_api_key' }
  }

  const authorization = request.headers.get('Authorization') ?? ''
  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
    signal: AbortSignal.timeout(6_000),
  }).catch(() => null)

  if (!response?.ok) return null
  const user = await response.json() as { id?: string; email?: string }
  if (!user.id) return null
  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email.toLowerCase() : null,
    method: 'supabase_session',
  }
}

function validateReturnBaseUrl(value: string, env: SwitchereFundingEnv): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null
    const configured = allowedOrigins(env)
    if (!configured.includes('*') && !configured.includes(url.origin)) return null
    return url.origin
  } catch {
    return null
  }
}

function normalizeAmount(value: unknown): string | null {
  const amount = String(value ?? '').trim()
  if (!AMOUNT_PATTERN.test(amount)) return null
  const parsed = Number.parseFloat(amount)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return amount
}

function providerStatusChecks(status: string, substatus: string | null) {
  const normalizedStatus = status.toLowerCase()
  const normalizedSubstatus = substatus?.toLowerCase() ?? null
  const authorizedStatuses = new Set(['auth_success', 'processing', 'processing_payout', 'finished', 'refunded'])
  const failedStatuses = new Set(['error', 'expired', 'canceled'])
  const pendingCardStatuses = new Set(['card_pending', 'card_manual_pending'])

  return {
    bankAuthorization: authorizedStatuses.has(normalizedStatus)
      ? 'passed'
      : failedStatuses.has(normalizedStatus)
        ? 'failed'
        : 'pending',
    bankSecondFactor: authorizedStatuses.has(normalizedStatus)
      ? 'provider_verified'
      : failedStatuses.has(normalizedStatus)
        ? 'failed'
        : 'provider_managed',
    cardVerification: authorizedStatuses.has(normalizedStatus)
      ? 'passed'
      : pendingCardStatuses.has(normalizedSubstatus ?? '')
        ? 'pending_manual_or_automated_review'
        : failedStatuses.has(normalizedStatus)
          ? 'failed'
          : 'pending',
  }
}

async function handleHealth(request: Request, env: SwitchereFundingEnv): Promise<Response> {
  let providerStatus = 'unavailable'
  try {
    const health = await fetchJson<{ status?: string }>('https://switchere.com/api/v2/partner/healthcheck')
    providerStatus = health.status === 'OK' ? 'ok' : 'degraded'
  } catch {
    providerStatus = 'unavailable'
  }

  const mode = env.SWITCHERE_MODE === 'production' ? 'production' : 'sandbox'
  return jsonResponse(request, env, {
    service: 'switchere-card-security-preflight',
    providerStatus,
    mode,
    partnerKeyConfigured: Boolean(env.SWITCHERE_PARTNER_KEY),
    callbackSecretConfigured: Boolean(env.SWITCHERE_CALLBACK_SECRET),
    supabaseVerificationConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
    liveFundingEnabled: mode === 'production' && env.SWITCHERE_LIVE_ENABLED === 'true',
    cardDataAcceptedByWorker: false,
    ts: Date.now(),
  })
}

async function handlePreflight(request: Request, env: SwitchereFundingEnv): Promise<Response> {
  const actor = await authenticateActor(request, env)
  if (!actor) {
    return jsonResponse(request, env, { error: 'Authenticated client session required' }, 401)
  }

  let body: PreflightRequest
  try {
    body = await request.json() as PreflightRequest
  } catch {
    return jsonResponse(request, env, { error: 'Invalid JSON body' }, 400)
  }

  if (hasCardSecretFields(body)) {
    return jsonResponse(request, env, {
      error: 'Card number, CVC, PIN, and magnetic-stripe data must be entered only inside the hosted Switchere widget',
    }, 400)
  }

  const clientReference = String(body.clientReference ?? '').trim()
  const requestedEmail = String(body.clientEmail ?? '').trim().toLowerCase()
  const clientEmail = actor.email ?? requestedEmail
  const country = String(body.clientCountry ?? '').trim().toUpperCase()
  const payinAmount = normalizeAmount(body.payinAmount)
  const payinCurrency = String(body.payinCurrency ?? '').trim().toUpperCase()
  const payoutCurrency = String(body.payoutCurrency ?? '').trim().toUpperCase()
  const dstAddress = String(body.dstAddress ?? '').trim()
  const returnBaseUrl = validateReturnBaseUrl(String(body.returnBaseUrl ?? ''), env)

  if (!clientReference || clientReference.length > 80) {
    return jsonResponse(request, env, { error: 'clientReference is required and must be 80 characters or fewer' }, 400)
  }
  if (!clientEmail || !clientEmail.includes('@')) {
    return jsonResponse(request, env, { error: 'A verified client email is required' }, 400)
  }
  if (actor.email && requestedEmail && actor.email !== requestedEmail) {
    return jsonResponse(request, env, { error: 'Client email does not match the authenticated account' }, 403)
  }
  if (!COUNTRY_PATTERN.test(country)) {
    return jsonResponse(request, env, { error: 'clientCountry must be a two-letter country code' }, 400)
  }
  if (!payinAmount) {
    return jsonResponse(request, env, { error: 'payinAmount must be a positive decimal amount' }, 400)
  }
  if (!CURRENCY_PATTERN.test(payinCurrency) || !CURRENCY_PATTERN.test(payoutCurrency)) {
    return jsonResponse(request, env, { error: 'Invalid pay-in or payout currency' }, 400)
  }
  if (dstAddress.length < 12 || dstAddress.length > 256) {
    return jsonResponse(request, env, { error: 'A valid destination wallet address is required' }, 400)
  }
  if (!returnBaseUrl) {
    return jsonResponse(request, env, { error: 'Return URL is not in the configured origin allowlist' }, 400)
  }
  if (!body.clientApproved || !body.cardholderNameMatch || !body.cardUsePermissionConfirmed) {
    return jsonResponse(request, env, {
      error: 'Client approval, cardholder-name match, and card-use permission must all be confirmed',
    }, 412)
  }

  const numericAmount = Number.parseFloat(payinAmount)
  const minimum = Number.parseFloat(env.FUNDING_MIN_AMOUNT ?? '1')
  const maximum = Number.parseFloat(env.FUNDING_MAX_AMOUNT ?? '5000')
  if (numericAmount < minimum || numericAmount > maximum) {
    return jsonResponse(request, env, {
      error: `Amount must be between ${minimum} and ${maximum} ${payinCurrency}`,
    }, 400)
  }

  if (!env.SWITCHERE_PARTNER_KEY) {
    return jsonResponse(request, env, { error: 'SWITCHERE_PARTNER_KEY is not configured' }, 503)
  }

  let countries: CountryRecord[]
  let currencyRoutes: Record<string, string[]>
  let paymentGroups: PaymentGroup[]
  try {
    ;[countries, currencyRoutes, paymentGroups] = await Promise.all([
      fetchJson<CountryRecord[]>('https://switchere.com/api/v2/public/country/list'),
      fetchJson<Record<string, string[]>>('https://switchere.com/api/v2/public/currency'),
      fetchJson<PaymentGroup[]>('https://switchere.com/api/v2/public/payment/payin'),
    ])
  } catch (error) {
    return jsonResponse(request, env, {
      error: error instanceof Error ? error.message : 'Switchere preflight service unavailable',
    }, 503)
  }

  const countryRule = countries.find((entry) => entry.code?.toUpperCase() === country)
  if (!countryRule || booleanValue(countryRule.forbidden) || booleanValue(countryRule.forbidden_card)) {
    return jsonResponse(request, env, { error: 'Card funding is not available for the client country' }, 422)
  }

  const payoutRoutes = currencyRoutes[payinCurrency] ?? []
  if (!payoutRoutes.map((value) => value.toUpperCase()).includes(payoutCurrency)) {
    return jsonResponse(request, env, { error: 'Requested currency route is not available' }, 422)
  }

  const cardGroup = paymentGroups.find((group) => group.group === 'card')
  const cardCurrencies = cardGroup?.list?.map((entry) => entry.currency?.toUpperCase()).filter(Boolean) ?? []
  if (!cardCurrencies.includes(payinCurrency)) {
    return jsonResponse(request, env, { error: 'Card payment is not available for the selected pay-in currency' }, 422)
  }

  const id = crypto.randomUUID()
  const partnerOrderId = `gem-${id}`.slice(0, 64)
  const statusToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  const statusTokenHash = await hashHex(statusToken)
  const actorHash = await hashHex(actor.id)
  const clientEmailHash = await hashHex(clientEmail)
  const dstAddressHash = await hashHex(dstAddress)
  const mode = env.SWITCHERE_MODE === 'production' ? 'production' : 'sandbox'
  const liveFundingEnabled = mode === 'production' && env.SWITCHERE_LIVE_ENABLED === 'true'

  if (mode === 'production' && !liveFundingEnabled) {
    return jsonResponse(request, env, { error: 'Production funding remains disabled' }, 423)
  }

  try {
    await env.DB.prepare(
      `INSERT INTO switchere_funding_sessions (
        id, partner_order_id, status_token_hash, actor_hash, client_reference,
        client_email_hash, client_country, payin_amount, payin_currency,
        payout_currency, dst_address_hash, provider_status,
        bank_authorization_status, bank_second_factor_status,
        card_verification_status, client_approved, live_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(
      id,
      partnerOrderId,
      statusTokenHash,
      actorHash,
      clientReference,
      clientEmailHash,
      country,
      payinAmount,
      payinCurrency,
      payoutCurrency,
      dstAddressHash,
      'preflight_passed',
      'pending',
      'provider_managed',
      'pending',
      liveFundingEnabled ? 1 : 0,
    ).run()
  } catch {
    return jsonResponse(request, env, {
      error: 'Funding session storage is unavailable; apply migration 031_switchere_funding_guard.sql',
    }, 503)
  }

  let feeQuote: Record<string, unknown> | null = null
  try {
    feeQuote = await fetchJson<Record<string, unknown>>('https://switchere.com/api/v2/public/order/fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_order_id: partnerOrderId,
        payin_currency: payinCurrency,
        payin_amount: payinAmount,
        payin_group: 'card',
        payout_currency: payoutCurrency,
        payout_group: 'crypto',
        is_floating_rate: 0,
      }),
    })
  } catch {
    feeQuote = null
  }

  const scriptUrl = mode === 'production'
    ? 'https://switchere.com/js/sdk-builder.js'
    : 'https://sandbox.switchere.com/js/sdk-builder.js'

  return jsonResponse(request, env, {
    sessionId: id,
    partnerOrderId,
    statusToken,
    mode,
    liveFundingEnabled,
    callbackUrl: `${new URL(request.url).origin}/funding/switchere/callback`,
    feeQuote,
    checks: {
      authenticatedClientSession: 'passed',
      clientApproval: 'passed',
      cardholderNameMatch: 'passed',
      cardUsePermission: 'passed',
      providerAvailability: 'passed',
      countryCardRule: 'passed',
      currencyRoute: 'passed',
      cardPaymentMethod: 'passed',
      bankAuthorization: 'pending',
      bankSecondFactor: 'provider_managed',
      cardVerification: 'pending',
    },
    widget: {
      scriptUrl,
      config: {
        partnerKey: env.SWITCHERE_PARTNER_KEY,
        partnerOrderId,
        payinAmount,
        payinCurrency,
        payinGroup: 'card',
        payoutCurrency,
        payoutGroup: 'crypto',
        dstAddress,
        ...(body.memo !== undefined && String(body.memo).trim() !== '' ? { memo: body.memo } : {}),
        clientEmail,
        httpReturnSuccess: `${returnBaseUrl}/card-funding?result=success&order=${encodeURIComponent(partnerOrderId)}`,
        httpReturnFailed: `${returnBaseUrl}/card-funding?result=failed&order=${encodeURIComponent(partnerOrderId)}`,
      },
    },
    ts: Date.now(),
  }, 201)
}

async function handleStatus(
  request: Request,
  env: SwitchereFundingEnv,
  partnerOrderId: string,
): Promise<Response> {
  if (!ORDER_ID_PATTERN.test(partnerOrderId)) {
    return jsonResponse(request, env, { error: 'Invalid partner order ID' }, 400)
  }
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!token) return jsonResponse(request, env, { error: 'Status token required' }, 401)
  const tokenHash = await hashHex(token)

  let row: Record<string, unknown> | null
  try {
    row = await env.DB.prepare(
      `SELECT partner_order_id, provider_status, provider_substatus, provider_error,
              masked_card, bank_authorization_status, bank_second_factor_status,
              card_verification_status, payin_amount, payin_currency,
              payout_amount, payout_currency, updated_at
       FROM switchere_funding_sessions
       WHERE partner_order_id = ? AND status_token_hash = ? LIMIT 1`,
    ).bind(partnerOrderId, tokenHash).first<Record<string, unknown>>()
  } catch {
    return jsonResponse(request, env, { error: 'Funding session storage unavailable' }, 503)
  }

  if (!row) return jsonResponse(request, env, { error: 'Funding session not found' }, 404)
  return jsonResponse(request, env, { order: row, ts: Date.now() })
}

async function handleCallback(request: Request, env: SwitchereFundingEnv): Promise<Response> {
  if (!env.SWITCHERE_CALLBACK_SECRET) {
    return jsonResponse(request, env, { error: 'Callback verification is not configured' }, 503)
  }

  const rawBody = await request.text()
  const signature = request.headers.get('API-Signature') ?? ''
  if (!signature || !await verifyCallbackSignature(rawBody, signature, env.SWITCHERE_CALLBACK_SECRET)) {
    return jsonResponse(request, env, { error: 'Invalid callback signature' }, 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return jsonResponse(request, env, { error: 'Invalid callback body' }, 400)
  }

  const nested = payload.client_order
  const order = (nested && typeof nested === 'object' ? nested : payload) as SwitchereCallbackOrder
  const partnerOrderId = String(order.partner_order_id ?? '').trim()
  if (!ORDER_ID_PATTERN.test(partnerOrderId)) {
    return jsonResponse(request, env, { error: 'Callback is missing a valid partner_order_id' }, 400)
  }

  const status = String(order.status ?? 'unknown').trim().toLowerCase()
  const latestLogStatus = Array.isArray(order.status_log)
    ? order.status_log.at(-1)?.status
    : undefined
  const substatus = String(order.substatus ?? latestLogStatus ?? '').trim().toLowerCase() || null
  const checks = providerStatusChecks(status, substatus)
  const maskedCard = typeof order.card_number === 'string' && order.card_number.includes('*')
    ? order.card_number.slice(0, 32)
    : null
  const providerError = typeof order.error_message === 'string'
    ? order.error_message.slice(0, 500)
    : null

  try {
    await env.DB.prepare(
      `UPDATE switchere_funding_sessions SET
         provider_status = ?, provider_substatus = ?, provider_error = ?,
         masked_card = ?, bank_authorization_status = ?,
         bank_second_factor_status = ?, card_verification_status = ?,
         payout_amount = ?, updated_at = CURRENT_TIMESTAMP
       WHERE partner_order_id = ?`,
    ).bind(
      status,
      substatus,
      providerError,
      maskedCard,
      checks.bankAuthorization,
      checks.bankSecondFactor,
      checks.cardVerification,
      order.payout_amount === undefined ? null : String(order.payout_amount),
      partnerOrderId,
    ).run()
  } catch {
    return jsonResponse(request, env, { error: 'Funding session storage unavailable' }, 503)
  }

  return new Response(null, { status: 204 })
}

export async function handleSwitchereFundingRequest(
  request: Request,
  env: SwitchereFundingEnv,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/funding/switchere')) return null

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }
  if (request.method === 'GET' && url.pathname === '/funding/switchere/health') {
    return handleHealth(request, env)
  }
  if (request.method === 'POST' && url.pathname === '/funding/switchere/preflight') {
    return handlePreflight(request, env)
  }
  if (request.method === 'POST' && url.pathname === '/funding/switchere/callback') {
    return handleCallback(request, env)
  }
  const statusMatch = url.pathname.match(/^\/funding\/switchere\/status\/([A-Za-z0-9_-]+)$/)
  if (request.method === 'GET' && statusMatch) {
    return handleStatus(request, env, statusMatch[1])
  }

  return jsonResponse(request, env, { error: 'Route not found' }, 404)
}
