import type { LiveRole, ScopedRole } from './authorization.ts'

export type OperatorReadResource =
  | 'ACTIVATION_GATE'
  | 'DEPLOYMENT_READINESS'
  | 'OPERATIONAL_REHEARSAL'
  | 'CERTIFICATION'
  | 'RECOVERY_READINESS'
  | 'RECONCILIATION'
  | 'ALERTS'
  | 'AUDIT_HEAD'

export interface OperatorReadAuthEnv {
  DB: D1Database
  OPERATOR_API_KEY_HASHES?: string
}

export interface OperatorReadScope {
  resource: OperatorReadResource
  exchangeName: string | null
  exchangeAccountId: string | null
}

export interface OperatorReadPrincipal {
  actorId: string
  roles: readonly ScopedRole[]
  matchedRoles: readonly LiveRole[]
}

export type OperatorReadAuthResult =
  | { status: 'AUTHORIZED'; principal: OperatorReadPrincipal }
  | { status: 'NOT_CONFIGURED'; code: 'OPERATOR_AUTH_NOT_CONFIGURED' }
  | { status: 'UNAUTHENTICATED'; code: 'OPERATOR_AUTHENTICATION_FAILED' }
  | { status: 'FORBIDDEN'; code: 'OPERATOR_READ_FORBIDDEN' }

const SHA256_PATTERN = /^[a-f0-9]{64}$/

const RESOURCE_ROLES: Readonly<Record<OperatorReadResource, readonly LiveRole[]>> = {
  ACTIVATION_GATE: ['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  DEPLOYMENT_READINESS: ['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  OPERATIONAL_REHEARSAL: ['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  CERTIFICATION: ['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  RECOVERY_READINESS: ['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  RECONCILIATION: ['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  ALERTS: ['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
  AUDIT_HEAD: ['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
}

type RoleRow = {
  role: LiveRole
  scope_type: ScopedRole['scopeType']
  scope_key: string
  expires_at: string | null
  revoked_at: string | null
}

function required(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

export function parseOperatorKeyHashes(value: unknown): Readonly<Record<string, string>> {
  const raw = String(value ?? '').trim()
  if (!raw) return Object.freeze({})

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return Object.freeze({})
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.freeze({})

  const normalized: Record<string, string> = {}
  for (const [actorIdRaw, hashRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const actorId = actorIdRaw.trim()
    const hash = String(hashRaw ?? '').trim().toLowerCase()
    if (!actorId || !SHA256_PATTERN.test(hash)) continue
    normalized[actorId] = hash
  }
  return Object.freeze(normalized)
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export function roleMatchesReadScope(
  role: ScopedRole,
  scope: OperatorReadScope,
  evaluatedAt: string,
): boolean {
  const now = Date.parse(evaluatedAt)
  if (!Number.isFinite(now)) throw new TypeError('evaluatedAt must be ISO-8601')
  if (role.revokedAt !== null) return false
  if (role.expiresAt !== null && Date.parse(role.expiresAt) <= now) return false
  if (!RESOURCE_ROLES[scope.resource].includes(role.role)) return false
  if (role.scopeType === 'GLOBAL') return true
  if (role.scopeType === 'EXCHANGE') {
    return scope.exchangeName !== null && role.scopeKey.toUpperCase() === scope.exchangeName.toUpperCase()
  }
  return scope.exchangeAccountId !== null && role.scopeKey === scope.exchangeAccountId
}

async function loadRoles(env: OperatorReadAuthEnv, actorId: string): Promise<readonly ScopedRole[]> {
  const result = await env.DB.prepare(`
    SELECT role, scope_type, scope_key, expires_at, revoked_at
      FROM live_actor_roles
     WHERE actor_id = ?
     ORDER BY role ASC, scope_type ASC, scope_key ASC
  `).bind(actorId).all<RoleRow>()

  return Object.freeze((result.results ?? []).map((row) => Object.freeze({
    role: row.role,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  })))
}

export async function authenticateOperatorRead(
  env: OperatorReadAuthEnv,
  request: Request,
  scope: OperatorReadScope,
  evaluatedAt = new Date().toISOString(),
): Promise<OperatorReadAuthResult> {
  const configured = parseOperatorKeyHashes(env.OPERATOR_API_KEY_HASHES)
  if (Object.keys(configured).length === 0) {
    return { status: 'NOT_CONFIGURED', code: 'OPERATOR_AUTH_NOT_CONFIGURED' }
  }

  const actorId = required(request.headers.get('X-Operator-Id'))
  const suppliedSecret = required(
    request.headers.get('X-API-Key')
      ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, ''),
  )
  if (!actorId || !suppliedSecret || !configured[actorId]) {
    return { status: 'UNAUTHENTICATED', code: 'OPERATOR_AUTHENTICATION_FAILED' }
  }

  const suppliedHash = await sha256Hex(suppliedSecret)
  if (!constantTimeHexEqual(suppliedHash, configured[actorId])) {
    return { status: 'UNAUTHENTICATED', code: 'OPERATOR_AUTHENTICATION_FAILED' }
  }

  const roles = await loadRoles(env, actorId)
  const matchedRoles = Object.freeze(Array.from(new Set(
    roles
      .filter((role) => roleMatchesReadScope(role, scope, evaluatedAt))
      .map((role) => role.role),
  )))
  if (matchedRoles.length === 0) {
    return { status: 'FORBIDDEN', code: 'OPERATOR_READ_FORBIDDEN' }
  }

  return {
    status: 'AUTHORIZED',
    principal: Object.freeze({ actorId, roles, matchedRoles }),
  }
}
