export type ManagementRole =
  | 'VIEWER'
  | 'TRADER'
  | 'RISK_OPERATOR'
  | 'RISK_ADMIN'
  | 'WITHDRAWAL_REQUESTER'
  | 'WITHDRAWAL_APPROVER'
  | 'AUDITOR'
  | 'RELEASE_ADMIN'

export type ManagementScopeType = 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT'
export type UserStatus = 'INVITED' | 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'

export interface ManagementEnv {
  DB: D1Database
  CORS_ALLOWED_ORIGINS?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
  SUPABASE_ANON_KEY?: string
}

export interface ManagementPermissions {
  canReadAdmin: boolean
  canManageUsers: boolean
  canManageAccess: boolean
  canViewAudit: boolean
  canViewUsage: boolean
  canManageSystem: boolean
}

type Identity = {
  actorId: string
  email: string | null
  displayName: string | null
}

type ProfileRow = {
  actor_id: string
  auth_provider_id: string
  email: string | null
  display_name: string | null
  status: UserStatus
  account_type: string
  onboarding_state: string
  created_at: string
  updated_at: string
  last_login_at: string | null
  suspended_at: string | null
  suspended_reason: string | null
}

type RoleRow = {
  actor_id: string
  role: ManagementRole
  scope_type: ManagementScopeType
  scope_key: string
  granted_by: string
  granted_at: string
  expires_at: string | null
  revoked_at: string | null
}

type AuthenticatedActor = {
  identity: Identity
  profile: ProfileRow
  roles: RoleRow[]
  permissions: ManagementPermissions
}

type ManagementOptions = {
  bootstrapAuthorized?: boolean
}

const ROLE_SET = new Set<ManagementRole>([
  'VIEWER',
  'TRADER',
  'RISK_OPERATOR',
  'RISK_ADMIN',
  'WITHDRAWAL_REQUESTER',
  'WITHDRAWAL_APPROVER',
  'AUDITOR',
  'RELEASE_ADMIN',
])

const STATUS_SET = new Set<UserStatus>(['INVITED', 'PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'])
const SCOPE_SET = new Set<ManagementScopeType>(['GLOBAL', 'EXCHANGE', 'ACCOUNT'])
const USAGE_EVENT_SET = new Set([
  'dashboard_view',
  'portfolio_view',
  'backtest_run',
  'signal_query',
  'paper_intent',
  'infrastructure_view',
  'operator_readiness_view',
  'account_view',
  'admin_view',
])

const READ_ADMIN_ROLES = new Set<ManagementRole>(['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'])

const MANAGEMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_user_profiles (
    actor_id TEXT PRIMARY KEY,
    auth_provider_id TEXT NOT NULL UNIQUE,
    email TEXT,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('INVITED','PENDING','ACTIVE','SUSPENDED','DISABLED')),
    account_type TEXT NOT NULL DEFAULT 'STANDARD',
    onboarding_state TEXT NOT NULL DEFAULT 'COMPLETE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT,
    suspended_at TEXT,
    suspended_reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_user_profiles_status_updated
    ON app_user_profiles(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_app_user_profiles_email
    ON app_user_profiles(email)`,
  `CREATE TABLE IF NOT EXISTS live_actor_roles (
    actor_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN (
      'VIEWER','TRADER','RISK_OPERATOR','RISK_ADMIN',
      'WITHDRAWAL_REQUESTER','WITHDRAWAL_APPROVER','AUDITOR','RELEASE_ADMIN'
    )),
    scope_type TEXT NOT NULL DEFAULT 'GLOBAL'
      CHECK (scope_type IN ('GLOBAL','EXCHANGE','ACCOUNT')),
    scope_key TEXT NOT NULL DEFAULT 'global',
    granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    PRIMARY KEY (actor_id, role, scope_type, scope_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_live_actor_roles_actor_scope
    ON live_actor_roles(actor_id, scope_type, scope_key, expires_at, revoked_at)`,
  `CREATE TABLE IF NOT EXISTS management_audit_events (
    sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('ALLOW','DENY')),
    reason TEXT,
    request_id TEXT NOT NULL,
    previous_state_json TEXT,
    new_state_json TEXT,
    event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_management_audit_actor_time
    ON management_audit_events(actor_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_management_audit_resource_time
    ON management_audit_events(resource_type, resource_id, occurred_at)`,
  `CREATE TRIGGER IF NOT EXISTS management_audit_events_no_update
    BEFORE UPDATE ON management_audit_events FOR EACH ROW BEGIN
      SELECT RAISE(ABORT, 'management_audit_events cannot be updated');
    END`,
  `CREATE TRIGGER IF NOT EXISTS management_audit_events_no_delete
    BEFORE DELETE ON management_audit_events FOR EACH ROW BEGIN
      SELECT RAISE(ABORT, 'management_audit_events cannot be deleted');
    END`,
  `CREATE TABLE IF NOT EXISTS app_usage_daily (
    day TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    category TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (day, actor_id, category)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_usage_daily_day_category
    ON app_usage_daily(day, category)`,
  `CREATE TABLE IF NOT EXISTS management_rate_windows (
    bucket TEXT NOT NULL,
    window_start TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS session_security_events (
    event_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    request_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_security_actor_time
    ON session_security_events(actor_id, occurred_at)`,
  `CREATE TRIGGER IF NOT EXISTS session_security_events_no_update
    BEFORE UPDATE ON session_security_events FOR EACH ROW BEGIN
      SELECT RAISE(ABORT, 'session_security_events cannot be updated');
    END`,
  `CREATE TRIGGER IF NOT EXISTS session_security_events_no_delete
    BEFORE DELETE ON session_security_events FOR EACH ROW BEGIN
      SELECT RAISE(ABORT, 'session_security_events cannot be deleted');
    END`,
] as const

let schemaPromise: Promise<void> | null = null

export async function ensureManagementSchema(env: ManagementEnv): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of MANAGEMENT_SCHEMA) {
        await env.DB.prepare(statement).run()
      }
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  await schemaPromise
}

function corsHeaders(request: Request, env: ManagementEnv): Headers {
  const configured = (env.CORS_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const origin = request.headers.get('Origin') || '*'
  const allowedOrigin = configured.includes('*')
    ? origin
    : configured.includes(origin)
      ? origin
      : 'null'
  return new Headers({
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Request-ID',
    'Access-Control-Expose-Headers': 'X-Request-ID, Retry-After',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  })
}

function requestId(request: Request): string {
  const supplied = request.headers.get('X-Request-ID')?.trim()
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID()
}

function json(
  request: Request,
  env: ManagementEnv,
  payload: unknown,
  status = 200,
  id = requestId(request),
  extraHeaders?: Record<string, string>,
): Response {
  const headers = corsHeaders(request, env)
  headers.set('X-Request-ID', id)
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value)
  return new Response(JSON.stringify(payload), { status, headers })
}

function errorResponse(
  request: Request,
  env: ManagementEnv,
  status: number,
  code: string,
  message: string,
  id: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return json(request, env, { error: message, code, request_id: id, ...(extra ?? {}) }, status, id, headers)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function nowIso(): string {
  return new Date().toISOString()
}

function today(): string {
  return nowIso().slice(0, 10)
}

function minuteWindow(): string {
  return nowIso().slice(0, 16)
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

async function verifySupabaseIdentity(
  request: Request,
  env: ManagementEnv,
): Promise<{ identity: Identity } | { status: number; code: string; message: string }> {
  const baseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '')
  const apiKey = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY)?.trim()
  if (!baseUrl || !apiKey) {
    return {
      status: 503,
      code: 'AUTH_PROVIDER_UNCONFIGURED',
      message: 'Production identity provider is not configured on the Worker.',
    }
  }

  const authorization = request.headers.get('Authorization')?.trim() || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return { status: 401, code: 'UNAUTHENTICATED', message: 'A valid bearer session is required.' }
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        apikey: apiKey,
        Accept: 'application/json',
      },
    })
  } catch {
    return { status: 503, code: 'DEPENDENCY_UNAVAILABLE', message: 'Identity provider is unavailable.' }
  }

  if (!response.ok) {
    return { status: 401, code: 'UNAUTHENTICATED', message: 'The supplied session is invalid or expired.' }
  }

  const payload = await response.json().catch(() => null) as {
    id?: unknown
    email?: unknown
    user_metadata?: Record<string, unknown>
  } | null
  const actorId = safeText(payload?.id, 128)
  if (!actorId) {
    return { status: 401, code: 'UNAUTHENTICATED', message: 'Identity provider returned an invalid user.' }
  }

  const displayName = safeText(
    payload?.user_metadata?.display_name ?? payload?.user_metadata?.full_name,
    160,
  )
  return {
    identity: {
      actorId,
      email: safeText(payload?.email, 320),
      displayName,
    },
  }
}

async function upsertProfile(env: ManagementEnv, identity: Identity): Promise<ProfileRow> {
  const now = nowIso()
  await env.DB.prepare(`
    INSERT INTO app_user_profiles (
      actor_id, auth_provider_id, email, display_name, status, account_type,
      onboarding_state, created_at, updated_at, last_login_at
    ) VALUES (?, ?, ?, ?, 'ACTIVE', 'STANDARD', 'COMPLETE', ?, ?, ?)
    ON CONFLICT(actor_id) DO UPDATE SET
      email = excluded.email,
      display_name = COALESCE(app_user_profiles.display_name, excluded.display_name),
      updated_at = excluded.updated_at,
      last_login_at = excluded.last_login_at
  `).bind(
    identity.actorId,
    identity.actorId,
    identity.email,
    identity.displayName,
    now,
    now,
    now,
  ).run()

  const profile = await env.DB.prepare(`
    SELECT actor_id, auth_provider_id, email, display_name, status, account_type,
           onboarding_state, created_at, updated_at, last_login_at,
           suspended_at, suspended_reason
      FROM app_user_profiles
     WHERE actor_id = ?
     LIMIT 1
  `).bind(identity.actorId).first<ProfileRow>()
  if (!profile) throw new Error('Profile persistence failed')
  return profile
}

async function loadRoles(env: ManagementEnv, actorId: string): Promise<RoleRow[]> {
  const now = nowIso()
  const result = await env.DB.prepare(`
    SELECT actor_id, role, scope_type, scope_key, granted_by, granted_at, expires_at, revoked_at
      FROM live_actor_roles
     WHERE actor_id = ?
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY role ASC, scope_type ASC, scope_key ASC
  `).bind(actorId, now).all<RoleRow>()
  return result.results ?? []
}

export function permissionsForRoles(roles: readonly Pick<RoleRow, 'role'>[]): ManagementPermissions {
  const values = new Set(roles.map((item) => item.role))
  const canReadAdmin = Array.from(values).some((role) => READ_ADMIN_ROLES.has(role))
  return {
    canReadAdmin,
    canManageUsers: values.has('RELEASE_ADMIN'),
    canManageAccess: values.has('RELEASE_ADMIN'),
    canViewAudit: values.has('AUDITOR') || values.has('RISK_ADMIN') || values.has('RELEASE_ADMIN'),
    canViewUsage: canReadAdmin,
    canManageSystem: values.has('RISK_ADMIN') || values.has('RELEASE_ADMIN'),
  }
}

async function authenticate(
  request: Request,
  env: ManagementEnv,
): Promise<AuthenticatedActor | { response: Response }> {
  const id = requestId(request)
  const identityResult = await verifySupabaseIdentity(request, env)
  if (!('identity' in identityResult)) {
    return {
      response: errorResponse(
        request,
        env,
        identityResult.status,
        identityResult.code,
        identityResult.message,
        id,
      ),
    }
  }
  try {
    const profile = await upsertProfile(env, identityResult.identity)
    const roles = await loadRoles(env, identityResult.identity.actorId)
    return {
      identity: identityResult.identity,
      profile,
      roles,
      permissions: permissionsForRoles(roles),
    }
  } catch {
    return {
      response: errorResponse(
        request,
        env,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'User-management storage is unavailable.',
        id,
      ),
    }
  }
}

function isActive(actor: AuthenticatedActor): boolean {
  return actor.profile.status === 'ACTIVE'
}

async function enforceRateLimit(
  env: ManagementEnv,
  bucket: string,
  limit: number,
): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
  const window = minuteWindow()
  await env.DB.prepare(`
    INSERT INTO management_rate_windows (bucket, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket, window_start) DO UPDATE SET request_count = request_count + 1
  `).bind(bucket, window).run()
  const row = await env.DB.prepare(`
    SELECT request_count FROM management_rate_windows
     WHERE bucket = ? AND window_start = ?
  `).bind(bucket, window).first<{ request_count: number }>()
  const count = Number(row?.request_count ?? 1)
  const seconds = new Date().getUTCSeconds()
  return { allowed: count <= limit, count, retryAfter: Math.max(1, 60 - seconds) }
}

async function recordUsage(
  env: ManagementEnv,
  actorId: string,
  category: string,
  outcome: 'success' | 'rejected',
): Promise<void> {
  const success = outcome === 'success' ? 1 : 0
  const rejected = outcome === 'rejected' ? 1 : 0
  await env.DB.prepare(`
    INSERT INTO app_usage_daily (
      day, actor_id, category, request_count, success_count, rejected_count, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(day, actor_id, category) DO UPDATE SET
      request_count = request_count + 1,
      success_count = success_count + excluded.success_count,
      rejected_count = rejected_count + excluded.rejected_count,
      updated_at = excluded.updated_at
  `).bind(today(), actorId, category, success, rejected, nowIso()).run().catch(() => undefined)
}

async function writeAudit(
  env: ManagementEnv,
  input: {
    actorId: string
    action: string
    resourceType: string
    resourceId: string
    decision: 'ALLOW' | 'DENY'
    reason?: string | null
    requestId: string
    previousState?: unknown
    newState?: unknown
  },
): Promise<void> {
  const occurredAt = nowIso()
  const eventId = crypto.randomUUID()
  const canonical = JSON.stringify({
    eventId,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    decision: input.decision,
    reason: input.reason ?? null,
    requestId: input.requestId,
    previousState: input.previousState ?? null,
    newState: input.newState ?? null,
    occurredAt,
  })
  const hash = await sha256(canonical)
  await env.DB.prepare(`
    INSERT INTO management_audit_events (
      event_id, actor_id, action, resource_type, resource_id, decision, reason,
      request_id, previous_state_json, new_state_json, event_hash, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventId,
    input.actorId,
    input.action,
    input.resourceType,
    input.resourceId,
    input.decision,
    input.reason ?? null,
    input.requestId,
    input.previousState === undefined ? null : JSON.stringify(input.previousState),
    input.newState === undefined ? null : JSON.stringify(input.newState),
    hash,
    occurredAt,
  ).run()
}

function publicProfile(profile: ProfileRow) {
  return {
    actor_id: profile.actor_id,
    email: profile.email,
    display_name: profile.display_name,
    status: profile.status,
    account_type: profile.account_type,
    onboarding_state: profile.onboarding_state,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    last_login_at: profile.last_login_at,
    suspended_at: profile.suspended_at,
    suspended_reason: profile.suspended_reason,
  }
}

function publicRole(role: RoleRow) {
  return {
    role: role.role,
    scope_type: role.scope_type,
    scope_key: role.scope_key,
    granted_by: role.granted_by,
    granted_at: role.granted_at,
    expires_at: role.expires_at,
  }
}

function requireActive(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  id: string,
): Response | null {
  if (isActive(actor)) return null
  const code = actor.profile.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_DISABLED'
  return errorResponse(
    request,
    env,
    403,
    code,
    `Account access is ${actor.profile.status.toLowerCase()}.`,
    id,
    { account_status: actor.profile.status },
  )
}

function requireAdminRead(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  id: string,
): Response | null {
  if (actor.permissions.canReadAdmin) return null
  return errorResponse(request, env, 403, 'FORBIDDEN', 'Administrative read access is required.', id)
}

function requireReleaseAdmin(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  id: string,
): Response | null {
  if (actor.permissions.canManageUsers) return null
  return errorResponse(request, env, 403, 'FORBIDDEN', 'RELEASE_ADMIN access is required.', id)
}

async function bootstrap(
  request: Request,
  env: ManagementEnv,
  options: ManagementOptions,
  id: string,
): Promise<Response> {
  if (!options.bootstrapAuthorized) {
    return errorResponse(request, env, 401, 'UNAUTHENTICATED', 'Bootstrap requires the server operator key.', id)
  }
  const identityResult = await verifySupabaseIdentity(request, env)
  if (!('identity' in identityResult)) {
    return errorResponse(
      request,
      env,
      identityResult.status,
      identityResult.code,
      identityResult.message,
      id,
    )
  }
  const rate = await enforceRateLimit(env, `bootstrap:${identityResult.identity.actorId}`, 5)
  if (!rate.allowed) {
    return errorResponse(
      request,
      env,
      429,
      'RATE_LIMITED',
      'Bootstrap rate limit exceeded.',
      id,
      { limit: 5, window: '1m' },
      { 'Retry-After': String(rate.retryAfter) },
    )
  }
  const profile = await upsertProfile(env, identityResult.identity)
  const now = nowIso()
  await env.DB.prepare(`
    INSERT INTO live_actor_roles (
      actor_id, role, scope_type, scope_key, granted_by, granted_at, expires_at, revoked_at
    ) VALUES (?, 'RELEASE_ADMIN', 'GLOBAL', 'global', 'SYSTEM_BOOTSTRAP', ?, NULL, NULL)
    ON CONFLICT(actor_id, role, scope_type, scope_key) DO UPDATE SET
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = NULL,
      revoked_at = NULL
  `).bind(identityResult.identity.actorId, now).run()
  await writeAudit(env, {
    actorId: identityResult.identity.actorId,
    action: 'BOOTSTRAP_RELEASE_ADMIN',
    resourceType: 'USER',
    resourceId: identityResult.identity.actorId,
    decision: 'ALLOW',
    reason: 'server_operator_key_and_authenticated_identity',
    requestId: id,
    newState: { role: 'RELEASE_ADMIN', scope_type: 'GLOBAL', scope_key: 'global' },
  })
  const roles = await loadRoles(env, identityResult.identity.actorId)
  return json(request, env, {
    ok: true,
    profile: publicProfile(profile),
    roles: roles.map(publicRole),
    permissions: permissionsForRoles(roles),
    live_capabilities_remain_disabled: true,
    request_id: id,
  }, 200, id)
}

async function handleMe(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  id: string,
): Promise<Response> {
  if (request.method === 'GET') {
    await recordUsage(env, actor.identity.actorId, 'account_read', 'success')
    return json(request, env, {
      profile: publicProfile(actor.profile),
      roles: actor.roles.map(publicRole),
      permissions: actor.permissions,
      access_allowed: isActive(actor),
      certification_mode: true,
      request_id: id,
    }, 200, id)
  }
  if (request.method !== 'PATCH') {
    return errorResponse(request, env, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', id)
  }
  const blocked = requireActive(request, env, actor, id)
  if (blocked) return blocked
  const body = await parseJsonBody(request)
  const displayName = safeText(body?.display_name, 160)
  if (!displayName) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'display_name is required.', id)
  }
  const previous = { display_name: actor.profile.display_name }
  const now = nowIso()
  await env.DB.prepare(`
    UPDATE app_user_profiles SET display_name = ?, updated_at = ? WHERE actor_id = ?
  `).bind(displayName, now, actor.identity.actorId).run()
  await writeAudit(env, {
    actorId: actor.identity.actorId,
    action: 'UPDATE_OWN_PROFILE',
    resourceType: 'USER',
    resourceId: actor.identity.actorId,
    decision: 'ALLOW',
    requestId: id,
    previousState: previous,
    newState: { display_name: displayName },
  })
  await recordUsage(env, actor.identity.actorId, 'account_write', 'success')
  return json(request, env, { ok: true, display_name: displayName, request_id: id }, 200, id)
}

async function listUsers(request: Request, env: ManagementEnv, id: string): Promise<Response> {
  const url = new URL(request.url)
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const search = (url.searchParams.get('search') || '').trim().slice(0, 120)
  const status = (url.searchParams.get('status') || '').trim().toUpperCase()
  const clauses: string[] = []
  const params: unknown[] = []
  if (search) {
    clauses.push('(LOWER(COALESCE(email,\'\')) LIKE ? OR LOWER(COALESCE(display_name,\'\')) LIKE ? OR LOWER(actor_id) LIKE ?)')
    const query = `%${search.toLowerCase()}%`
    params.push(query, query, query)
  }
  if (status && STATUS_SET.has(status as UserStatus)) {
    clauses.push('status = ?')
    params.push(status)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await env.DB.prepare(`
    SELECT actor_id, auth_provider_id, email, display_name, status, account_type,
           onboarding_state, created_at, updated_at, last_login_at, suspended_at, suspended_reason
      FROM app_user_profiles
      ${where}
     ORDER BY updated_at DESC
     LIMIT ?
  `).bind(...params, limit).all<ProfileRow>()
  return json(request, env, {
    users: (result.results ?? []).map(publicProfile),
    count: result.results?.length ?? 0,
    limit,
    request_id: id,
  }, 200, id)
}

async function getUser(
  request: Request,
  env: ManagementEnv,
  targetId: string,
  id: string,
): Promise<Response> {
  const profile = await env.DB.prepare(`
    SELECT actor_id, auth_provider_id, email, display_name, status, account_type,
           onboarding_state, created_at, updated_at, last_login_at, suspended_at, suspended_reason
      FROM app_user_profiles WHERE actor_id = ? LIMIT 1
  `).bind(targetId).first<ProfileRow>()
  if (!profile) return errorResponse(request, env, 404, 'NOT_FOUND', 'User was not found.', id)
  const roles = await loadRoles(env, targetId)
  return json(request, env, {
    profile: publicProfile(profile),
    roles: roles.map(publicRole),
    request_id: id,
  }, 200, id)
}

async function updateUser(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  targetId: string,
  id: string,
): Promise<Response> {
  if (targetId === actor.identity.actorId) {
    return errorResponse(
      request,
      env,
      409,
      'SEPARATION_OF_DUTIES',
      'Administrative lifecycle changes to your own account are blocked.',
      id,
    )
  }
  const existing = await env.DB.prepare(`
    SELECT actor_id, auth_provider_id, email, display_name, status, account_type,
           onboarding_state, created_at, updated_at, last_login_at, suspended_at, suspended_reason
      FROM app_user_profiles WHERE actor_id = ? LIMIT 1
  `).bind(targetId).first<ProfileRow>()
  if (!existing) return errorResponse(request, env, 404, 'NOT_FOUND', 'User was not found.', id)

  const body = await parseJsonBody(request)
  const requestedStatus = safeText(body?.status, 32)?.toUpperCase()
  const requestedName = safeText(body?.display_name, 160)
  if (!requestedStatus && !requestedName) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'status or display_name is required.', id)
  }
  if (requestedStatus && !STATUS_SET.has(requestedStatus as UserStatus)) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'Invalid user status.', id)
  }
  const status = (requestedStatus as UserStatus | undefined) ?? existing.status
  const displayName = requestedName ?? existing.display_name
  const reason = safeText(body?.reason, 500)
  if (status === 'SUSPENDED' && !reason) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'Suspension reason is required.', id)
  }
  const now = nowIso()
  await env.DB.prepare(`
    UPDATE app_user_profiles
       SET status = ?, display_name = ?, updated_at = ?,
           suspended_at = ?, suspended_reason = ?
     WHERE actor_id = ?
  `).bind(
    status,
    displayName,
    now,
    status === 'SUSPENDED' ? now : null,
    status === 'SUSPENDED' ? reason : null,
    targetId,
  ).run()
  await writeAudit(env, {
    actorId: actor.identity.actorId,
    action: 'UPDATE_USER',
    resourceType: 'USER',
    resourceId: targetId,
    decision: 'ALLOW',
    reason,
    requestId: id,
    previousState: publicProfile(existing),
    newState: { status, display_name: displayName },
  })
  return json(request, env, { ok: true, actor_id: targetId, status, display_name: displayName, request_id: id }, 200, id)
}

async function grantRole(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  targetId: string,
  id: string,
): Promise<Response> {
  const body = await parseJsonBody(request)
  const role = safeText(body?.role, 64)?.toUpperCase() as ManagementRole | undefined
  const scopeType = (safeText(body?.scope_type, 32)?.toUpperCase() || 'GLOBAL') as ManagementScopeType
  const scopeKey = safeText(body?.scope_key, 160) || (scopeType === 'GLOBAL' ? 'global' : null)
  const expiresAt = safeText(body?.expires_at, 64)
  if (!role || !ROLE_SET.has(role) || !SCOPE_SET.has(scopeType) || !scopeKey) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'A valid role and scope are required.', id)
  }
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'expires_at must be ISO-8601.', id)
  }
  if (targetId === actor.identity.actorId) {
    return errorResponse(
      request,
      env,
      409,
      'SEPARATION_OF_DUTIES',
      'Self-granting roles is not permitted.',
      id,
    )
  }
  const target = await env.DB.prepare('SELECT actor_id FROM app_user_profiles WHERE actor_id = ? LIMIT 1')
    .bind(targetId).first<{ actor_id: string }>()
  if (!target) return errorResponse(request, env, 404, 'NOT_FOUND', 'User was not found.', id)
  const now = nowIso()
  await env.DB.prepare(`
    INSERT INTO live_actor_roles (
      actor_id, role, scope_type, scope_key, granted_by, granted_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(actor_id, role, scope_type, scope_key) DO UPDATE SET
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      revoked_at = NULL
  `).bind(targetId, role, scopeType, scopeKey, actor.identity.actorId, now, expiresAt).run()
  await writeAudit(env, {
    actorId: actor.identity.actorId,
    action: 'GRANT_ROLE',
    resourceType: 'ROLE_GRANT',
    resourceId: `${targetId}:${role}:${scopeType}:${scopeKey}`,
    decision: 'ALLOW',
    requestId: id,
    newState: { actor_id: targetId, role, scope_type: scopeType, scope_key: scopeKey, expires_at: expiresAt },
  })
  return json(request, env, { ok: true, actor_id: targetId, role, scope_type: scopeType, scope_key: scopeKey, expires_at: expiresAt, request_id: id }, 201, id)
}

async function revokeRole(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  targetId: string,
  id: string,
): Promise<Response> {
  const body = await parseJsonBody(request)
  const role = safeText(body?.role, 64)?.toUpperCase() as ManagementRole | undefined
  const scopeType = (safeText(body?.scope_type, 32)?.toUpperCase() || 'GLOBAL') as ManagementScopeType
  const scopeKey = safeText(body?.scope_key, 160) || (scopeType === 'GLOBAL' ? 'global' : null)
  if (!role || !ROLE_SET.has(role) || !SCOPE_SET.has(scopeType) || !scopeKey) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'A valid role and scope are required.', id)
  }
  if (targetId === actor.identity.actorId && role === 'RELEASE_ADMIN') {
    return errorResponse(
      request,
      env,
      409,
      'SEPARATION_OF_DUTIES',
      'Self-revocation of RELEASE_ADMIN must be performed by another release administrator.',
      id,
    )
  }
  const now = nowIso()
  const result = await env.DB.prepare(`
    UPDATE live_actor_roles SET revoked_at = ?
     WHERE actor_id = ? AND role = ? AND scope_type = ? AND scope_key = ? AND revoked_at IS NULL
  `).bind(now, targetId, role, scopeType, scopeKey).run()
  if (!result.meta.changes) {
    return errorResponse(request, env, 404, 'NOT_FOUND', 'Active role grant was not found.', id)
  }
  await writeAudit(env, {
    actorId: actor.identity.actorId,
    action: 'REVOKE_ROLE',
    resourceType: 'ROLE_GRANT',
    resourceId: `${targetId}:${role}:${scopeType}:${scopeKey}`,
    decision: 'ALLOW',
    requestId: id,
    previousState: { actor_id: targetId, role, scope_type: scopeType, scope_key: scopeKey },
    newState: { revoked_at: now },
  })
  return json(request, env, { ok: true, actor_id: targetId, role, scope_type: scopeType, scope_key: scopeKey, revoked_at: now, request_id: id }, 200, id)
}

async function summary(request: Request, env: ManagementEnv, id: string): Promise<Response> {
  const [users, active, suspended, roles, audit24h, usageToday] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM app_user_profiles').first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM app_user_profiles WHERE status = 'ACTIVE'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM app_user_profiles WHERE status = 'SUSPENDED'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM live_actor_roles WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").bind(nowIso()).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM management_audit_events WHERE occurred_at >= datetime('now','-1 day')").first<{ count: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(request_count),0) AS count FROM app_usage_daily WHERE day = ?').bind(today()).first<{ count: number }>(),
  ])
  return json(request, env, {
    users_total: Number(users?.count ?? 0),
    users_active: Number(active?.count ?? 0),
    users_suspended: Number(suspended?.count ?? 0),
    active_role_grants: Number(roles?.count ?? 0),
    audit_events_24h: Number(audit24h?.count ?? 0),
    usage_requests_today: Number(usageToday?.count ?? 0),
    trading_mode: 'paper',
    network: 'testnet',
    allow_mainnet: false,
    live_trading_enabled: false,
    withdrawals_enabled: false,
    provider_mutation_enabled: false,
    request_id: id,
  }, 200, id)
}

async function listAudit(request: Request, env: ManagementEnv, id: string): Promise<Response> {
  const url = new URL(request.url)
  const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100))
  const actorId = safeText(url.searchParams.get('actor_id'), 128)
  const action = safeText(url.searchParams.get('action'), 80)
  const clauses: string[] = []
  const params: unknown[] = []
  if (actorId) { clauses.push('actor_id = ?'); params.push(actorId) }
  if (action) { clauses.push('action = ?'); params.push(action) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await env.DB.prepare(`
    SELECT event_id, actor_id, action, resource_type, resource_id, decision, reason,
           request_id, event_hash, occurred_at
      FROM management_audit_events
      ${where}
     ORDER BY sequence_id DESC
     LIMIT ?
  `).bind(...params, limit).all<Record<string, unknown>>()
  return json(request, env, { events: result.results ?? [], count: result.results?.length ?? 0, limit, request_id: id }, 200, id)
}

async function usageSummary(request: Request, env: ManagementEnv, id: string): Promise<Response> {
  const url = new URL(request.url)
  const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get('days') || '30', 10) || 30))
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const byCategory = await env.DB.prepare(`
    SELECT category,
           SUM(request_count) AS request_count,
           SUM(success_count) AS success_count,
           SUM(rejected_count) AS rejected_count
      FROM app_usage_daily
     WHERE day >= ?
     GROUP BY category
     ORDER BY request_count DESC
  `).bind(since).all<Record<string, unknown>>()
  const byDay = await env.DB.prepare(`
    SELECT day,
           SUM(request_count) AS request_count,
           SUM(success_count) AS success_count,
           SUM(rejected_count) AS rejected_count
      FROM app_usage_daily
     WHERE day >= ?
     GROUP BY day
     ORDER BY day DESC
  `).bind(since).all<Record<string, unknown>>()
  return json(request, env, { days, since, by_category: byCategory.results ?? [], by_day: byDay.results ?? [], request_id: id }, 200, id)
}

async function sessionEvents(request: Request, env: ManagementEnv, id: string): Promise<Response> {
  const url = new URL(request.url)
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const result = await env.DB.prepare(`
    SELECT event_id, actor_id, event_type, request_id, occurred_at
      FROM session_security_events
     ORDER BY occurred_at DESC
     LIMIT ?
  `).bind(limit).all<Record<string, unknown>>()
  return json(request, env, {
    events: result.results ?? [],
    count: result.results?.length ?? 0,
    provider_managed_sessions: true,
    note: 'Session issuance and global revocation remain authoritative at the external identity provider.',
    request_id: id,
  }, 200, id)
}

async function recordSessionEvent(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  id: string,
): Promise<Response> {
  const body = await parseJsonBody(request)
  const type = safeText(body?.event_type, 64)?.toUpperCase()
  if (!type || !['SESSION_RESTORED', 'PASSWORD_UPDATED', 'SECURITY_REVIEWED'].includes(type)) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'Unsupported session security event.', id)
  }
  const eventId = crypto.randomUUID()
  await env.DB.prepare(`
    INSERT INTO session_security_events (event_id, actor_id, event_type, request_id, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(eventId, actor.identity.actorId, type, id, nowIso()).run()
  return json(request, env, { ok: true, event_id: eventId, request_id: id }, 201, id)
}

async function recordFeatureUsage(
  request: Request,
  env: ManagementEnv,
  actor: AuthenticatedActor,
  id: string,
): Promise<Response> {
  const body = await parseJsonBody(request)
  const category = safeText(body?.category, 64)
  if (!category || !USAGE_EVENT_SET.has(category)) {
    return errorResponse(request, env, 400, 'VALIDATION_ERROR', 'Unsupported usage category.', id)
  }
  await recordUsage(env, actor.identity.actorId, category, 'success')
  return json(request, env, { ok: true, category, request_id: id }, 202, id)
}

async function systemStatus(request: Request, env: ManagementEnv, id: string): Promise<Response> {
  const db = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>().catch(() => null)
  return json(request, env, {
    d1_status: db?.ok === 1 ? 'healthy' : 'unavailable',
    identity_provider_configured: Boolean(
      env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY),
    ),
    management_schema: 'v1',
    rate_policy: {
      authenticated_read_per_minute: 120,
      authenticated_write_per_minute: 30,
      bootstrap_per_minute: 5,
    },
    safety: {
      trading_mode: 'paper',
      network: 'testnet',
      allow_mainnet: false,
      live_trading_enabled: false,
      withdrawals_enabled: false,
      provider_mutation_enabled: false,
      real_funds_enabled: false,
    },
    request_id: id,
  }, 200, id)
}

export async function handleManagementRequest(
  request: Request,
  env: ManagementEnv,
  options: ManagementOptions = {},
): Promise<Response> {
  const id = requestId(request)
  try {
    await ensureManagementSchema(env)
  } catch {
    return errorResponse(request, env, 503, 'DEPENDENCY_UNAVAILABLE', 'Management schema is unavailable.', id)
  }

  const url = new URL(request.url)
  const path = url.pathname
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  if (path === '/v1/management/bootstrap' && request.method === 'POST') {
    return bootstrap(request, env, options, id)
  }

  const auth = await authenticate(request, env)
  if ('response' in auth) return auth.response
  const actor = auth
  const rateClass = request.method === 'GET' ? 'read' : 'write'
  const limit = request.method === 'GET' ? 120 : 30
  const rate = await enforceRateLimit(env, `actor:${actor.identity.actorId}:${rateClass}`, limit)
  if (!rate.allowed) {
    await recordUsage(env, actor.identity.actorId, `management_${rateClass}`, 'rejected')
    return errorResponse(
      request,
      env,
      429,
      'RATE_LIMITED',
      'Management request rate limit exceeded.',
      id,
      { limit, window: '1m', current: rate.count },
      { 'Retry-After': String(rate.retryAfter) },
    )
  }

  if (path === '/v1/management/me') return handleMe(request, env, actor, id)

  const activeBlock = requireActive(request, env, actor, id)
  if (activeBlock) {
    await recordUsage(env, actor.identity.actorId, 'management_access', 'rejected')
    return activeBlock
  }

  if (path === '/v1/management/usage/events' && request.method === 'POST') {
    return recordFeatureUsage(request, env, actor, id)
  }
  if (path === '/v1/management/session-events' && request.method === 'POST') {
    return recordSessionEvent(request, env, actor, id)
  }

  const adminBlock = requireAdminRead(request, env, actor, id)
  if (adminBlock) {
    await recordUsage(env, actor.identity.actorId, 'admin_access', 'rejected')
    return adminBlock
  }

  await recordUsage(env, actor.identity.actorId, 'admin_access', 'success')

  if (path === '/v1/management/summary' && request.method === 'GET') return summary(request, env, id)
  if (path === '/v1/management/users' && request.method === 'GET') return listUsers(request, env, id)
  if (path === '/v1/management/audit' && request.method === 'GET') {
    if (!actor.permissions.canViewAudit) return errorResponse(request, env, 403, 'FORBIDDEN', 'Audit access is required.', id)
    return listAudit(request, env, id)
  }
  if (path === '/v1/management/usage' && request.method === 'GET') {
    if (!actor.permissions.canViewUsage) return errorResponse(request, env, 403, 'FORBIDDEN', 'Usage access is required.', id)
    return usageSummary(request, env, id)
  }
  if (path === '/v1/management/sessions' && request.method === 'GET') return sessionEvents(request, env, id)
  if (path === '/v1/management/system' && request.method === 'GET') {
    if (!actor.permissions.canManageSystem && !actor.permissions.canViewAudit) {
      return errorResponse(request, env, 403, 'FORBIDDEN', 'System visibility is required.', id)
    }
    return systemStatus(request, env, id)
  }

  const userMatch = path.match(/^\/v1\/management\/users\/([^/]+)$/)
  if (userMatch) {
    const targetId = decodeURIComponent(userMatch[1])
    if (request.method === 'GET') return getUser(request, env, targetId, id)
    if (request.method === 'PATCH') {
      const block = requireReleaseAdmin(request, env, actor, id)
      if (block) return block
      return updateUser(request, env, actor, targetId, id)
    }
  }

  const roleMatch = path.match(/^\/v1\/management\/users\/([^/]+)\/roles$/)
  if (roleMatch) {
    const block = requireReleaseAdmin(request, env, actor, id)
    if (block) return block
    const targetId = decodeURIComponent(roleMatch[1])
    if (request.method === 'POST') return grantRole(request, env, actor, targetId, id)
    if (request.method === 'DELETE') return revokeRole(request, env, actor, targetId, id)
  }

  return errorResponse(request, env, 404, 'NOT_FOUND', 'Management route not found.', id)
}
