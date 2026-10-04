import { BitgetCertificationSecretsStoreProvider, type BitgetCertificationSecretsStoreEnv } from './adapters/bitget/certification-secret-provider.ts'
import { BitgetReadOnlyClient, type BitgetAccountPermissions } from './adapters/bitget/read-only-client.ts'
import { certifyBitgetReadOnlyContracts } from './bitget-read-only-certification.ts'
import { canonicalHash } from './canonical-json.ts'
import { constantTimeHexEqual, sha256Hex } from './operator-read-auth.ts'

export interface PrivateCertificationEnv extends BitgetCertificationSecretsStoreEnv {
  CERTIFICATION_RUNNER_TOKEN?: string
}
export interface PrivateCertificationDependencies {
  fetcher: typeof fetch
  clock: () => number
  timeoutMs?: number
  secretTimeoutMs?: number
  bodyTimeoutMs?: number
}

const ID = /^[A-Za-z0-9:._-]{1,128}$/
const HASH = /^[a-f0-9]{64}$/
const locks = Object.freeze({ certifiedForLive: false, providerMutationAllowed: false,
  executionAllowed: false, withdrawalAllowed: false, transferAllowed: false,
  automaticRetryAllowed: false, credentialsPersisted: false,
  accountModel: 'UNVERIFIED', contract: 'BITGET_CLASSIC_SPOT_V2' })
const reply = (payload: Record<string, unknown>, status: number) => Response.json({ ...payload, ...locks }, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
})
class ServiceError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
function fail(code: string): never { throw new ServiceError(code) }
function limit(value: number | undefined, fallback: number) {
  const number = value ?? fallback
  if (!Number.isInteger(number) || number < 100 || number > 10_000) fail('CERTIFICATION_CONFIG_INVALID')
  return number
}
async function bounded<T>(operation: Promise<T>, ms: number, code: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new ServiceError(code)) }, ms)
    })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
async function readCommand(request: Request, timeoutMs: number): Promise<Record<string, string>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail('CERTIFICATION_COMMAND_INVALID')
  const reader = request.body?.getReader()
  if (!reader) fail('CERTIFICATION_COMMAND_INVALID')
  const chunks: Uint8Array[] = []; let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  const collect = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2048) { cancel(); fail('CERTIFICATION_COMMAND_INVALID') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) }
    catch { fail('CERTIFICATION_COMMAND_INVALID') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('CERTIFICATION_COMMAND_INVALID')
    const command = parsed as Record<string, unknown>
    const keys = ['runId','exchangeAccountId','expectedAccountRefHash','productId']
    if (Object.keys(command).length !== keys.length || keys.some(k => typeof command[k] !== 'string')
      || !ID.test(String(command.runId)) || !ID.test(String(command.exchangeAccountId))
      || !HASH.test(String(command.expectedAccountRefHash))
      || !/^[A-Z0-9]{2,20}-[A-Z0-9]{2,20}$/.test(String(command.productId))) fail('CERTIFICATION_COMMAND_INVALID')
    const [base, quote] = String(command.productId).split('-')
    if (base === quote || base.length + quote.length > 30) fail('CERTIFICATION_COMMAND_INVALID')
    return Object.freeze({ runId: String(command.runId), exchangeAccountId: String(command.exchangeAccountId),
      expectedAccountRefHash: String(command.expectedAccountRefHash), productId: String(command.productId) })
  }
  return bounded(collect(), timeoutMs, 'CERTIFICATION_COMMAND_TIMEOUT', cancel)
}

/** Private service-binding ingress. GET is the only outbound provider method.
 * No automatic certification persistence, release projection or activation.
 * The service token is an infrastructure credential generated at deployment;
 * provider-issued values stay in request-local Secrets Store material.
 */
export async function routePrivateBitgetCertification(
  request: Request, env: PrivateCertificationEnv, dependencies: PrivateCertificationDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname
  if (!['/internal/bitget/inspect','/internal/bitget/certify'].includes(path)) return reply({ code: 'CERTIFICATION_ROUTE_NOT_FOUND' },404)
  if (request.method !== 'POST') return reply({ code: 'CERTIFICATION_METHOD_NOT_ALLOWED' },405)
  const token = env.CERTIFICATION_RUNNER_TOKEN
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return reply({ code: 'CERTIFICATION_AUTH_NOT_CONFIGURED' },503)
  const supplied = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
  if (!supplied || supplied.length > 256 || !constantTimeHexEqual(await sha256Hex(token),await sha256Hex(supplied))) {
    return reply({ code: 'CERTIFICATION_UNAUTHORIZED' },401)
  }
  try {
    if (typeof dependencies.fetcher !== 'function' || typeof dependencies.clock !== 'function') fail('CERTIFICATION_CONFIG_INVALID')
    const secretMs = limit(dependencies.secretTimeoutMs,5000)
    const bodyMs = limit(dependencies.bodyTimeoutMs,3000)
    const providerMs = limit(dependencies.timeoutMs,8000)
    const clock = () => {
      const ms = dependencies.clock()
      if (!Number.isSafeInteger(ms) || ms < 1_000_000_000_000 || ms > 9_999_999_999_999) fail('CERTIFICATION_CLOCK_INVALID')
      return ms
    }
    const command = path.endsWith('/certify') ? await readCommand(request,bodyMs) : null
    const started = clock()
    // Validate all bindings before reading any value. No trade binding is used.
    if (![env.BITGET_CERT_API_KEY,env.BITGET_CERT_API_SECRET,env.BITGET_CERT_API_PASSPHRASE]
      .every(binding => binding && typeof binding.get === 'function')) fail('CERTIFICATION_SECRETS_UNAVAILABLE')
    const provider = new BitgetCertificationSecretsStoreProvider(env)
    const material = await bounded(provider.read(),secretMs,'CERTIFICATION_SECRETS_TIMEOUT')
    const client = new BitgetReadOnlyClient({ secretProvider: { read: async () => material },
      fetcher: dependencies.fetcher, now: clock, timeoutMs: providerMs, maxResponseBytes: 131072 })
    const permissions = await client.verifyReadOnlyPermissions()
    // Only the currently reviewed spot/tax read authorities are supported here.
    // Unknown permissions require review; absence of a known write code is insufficient.
    if (!permissions.authorities.includes('stor') || permissions.authorities.some(a => !['stor','taxr'].includes(a))) {
      fail('CERTIFICATION_PERMISSION_UNVERIFIED')
    }
    const accountRefHash = await canonicalHash(permissions.userId)
    if (!command) return reply({ code: 'CERTIFICATION_IDENTITY_INSPECTED', accountRefHash,
      permissionsVerified: true, accountModelVerified: false,
      authorityCount: permissions.authorities.length, authoritiesHash: await canonicalHash([...permissions.authorities].sort()) },200)
    if (accountRefHash !== command.expectedAccountRefHash) return reply({ code: 'CERTIFICATION_ACCOUNT_MISMATCH' },403)
    const [baseAsset,quoteAsset] = command.productId.split('-')
    const observedAt = new Date(clock()).toISOString()
    const end = clock()
    const result = await certifyBitgetReadOnlyContracts({ runId: command.runId,
      exchangeAccountId: command.exchangeAccountId, productId: command.productId, baseAsset, quoteAsset,
      windowStartMs: end - 60 * 60 * 1000, windowEndMs: end, observedAt,
      productExpiresAt: new Date(end + 120000).toISOString(), evaluatedAt: new Date(end).toISOString(),
      client: { verifyReadOnlyPermissions: async (): Promise<BitgetAccountPermissions> => permissions,
        request: (endpoint,query) => client.request(endpoint,query), listAccountAssets: coin => client.listAccountAssets(coin),
        listCurrentOrders: query => client.listCurrentOrders(query), listHistoryOrders: query => client.listHistoryOrders(query),
        listFills: query => client.listFills(query) },
    })
    const completed = clock()
    if (end < started || completed < end || completed - started > 65000) fail('CERTIFICATION_RUN_STALE')
    return reply({ code: 'CERTIFICATION_CONTRACTS_EVALUATED', accountRefHash,
      accountModelVerified: false, runDurationMs: completed - started, result },200)
  } catch (error) {
    // Fixed allowlist only: upstream messages, headers, body and secret values
    // never enter errors returned to the caller.
    const code = error instanceof ServiceError ? error.code : 'CERTIFICATION_PROVIDER_UNAVAILABLE'
    return reply({ code },503)
  }
}
