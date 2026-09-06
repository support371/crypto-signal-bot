import { env } from './env';

export type ManagementRole =
  | 'VIEWER'
  | 'TRADER'
  | 'RISK_OPERATOR'
  | 'RISK_ADMIN'
  | 'WITHDRAWAL_REQUESTER'
  | 'WITHDRAWAL_APPROVER'
  | 'AUDITOR'
  | 'RELEASE_ADMIN';

export type UserStatus = 'INVITED' | 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface ManagementProfile {
  actor_id: string;
  email: string | null;
  display_name: string | null;
  status: UserStatus;
  account_type: string;
  onboarding_state: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
}

export interface ManagementRoleGrant {
  role: ManagementRole;
  scope_type: 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT';
  scope_key: string;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
}

export interface ManagementPermissions {
  canReadAdmin: boolean;
  canManageUsers: boolean;
  canManageAccess: boolean;
  canViewAudit: boolean;
  canViewUsage: boolean;
  canManageSystem: boolean;
}

export interface ManagementMe {
  profile: ManagementProfile;
  roles: ManagementRoleGrant[];
  permissions: ManagementPermissions;
  access_allowed: boolean;
  certification_mode: boolean;
  request_id: string;
}

export interface ManagementSummary {
  users_total: number;
  users_active: number;
  users_suspended: number;
  active_role_grants: number;
  audit_events_24h: number;
  usage_requests_today: number;
  trading_mode: string;
  network: string;
  allow_mainnet: boolean;
  live_trading_enabled: boolean;
  withdrawals_enabled: boolean;
  provider_mutation_enabled: boolean;
  request_id: string;
}

export class ManagementApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, requestId: string | null = null) {
    super(message);
    this.name = 'ManagementApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function apiUrl(path: string): string {
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  if (!base) throw new ManagementApiError(503, 'BACKEND_UNAVAILABLE', 'Backend URL is not configured.');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      'X-Request-ID': crypto.randomUUID(),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null) as Record<string, unknown> | null
    : null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Management API returned HTTP ${response.status}`;
    const code = typeof payload?.code === 'string' ? payload.code : `HTTP_${response.status}`;
    const requestId = typeof payload?.request_id === 'string'
      ? payload.request_id
      : response.headers.get('x-request-id');
    throw new ManagementApiError(response.status, code, message, requestId);
  }
  return payload as T;
}

export const managementApi = {
  me(token: string) {
    return requestJson<ManagementMe>('/v1/management/me', token);
  },

  updateMe(token: string, displayName: string) {
    return requestJson<{ ok: boolean; display_name: string; request_id: string }>(
      '/v1/management/me',
      token,
      { method: 'PATCH', body: JSON.stringify({ display_name: displayName }) },
    );
  },

  summary(token: string) {
    return requestJson<ManagementSummary>('/v1/management/summary', token);
  },

  users(token: string, search = '', status = '') {
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    if (status.trim()) params.set('status', status.trim());
    return requestJson<{ users: ManagementProfile[]; count: number; request_id: string }>(
      `/v1/management/users?${params.toString()}`,
      token,
    );
  },

  user(token: string, actorId: string) {
    return requestJson<{ profile: ManagementProfile; roles: ManagementRoleGrant[]; request_id: string }>(
      `/v1/management/users/${encodeURIComponent(actorId)}`,
      token,
    );
  },

  updateUser(token: string, actorId: string, input: { status?: UserStatus; display_name?: string; reason?: string }) {
    return requestJson<{ ok: boolean; actor_id: string; status: UserStatus; request_id: string }>(
      `/v1/management/users/${encodeURIComponent(actorId)}`,
      token,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  },

  grantRole(
    token: string,
    actorId: string,
    input: { role: ManagementRole; scope_type: 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT'; scope_key: string; expires_at?: string | null },
  ) {
    return requestJson<{ ok: boolean; request_id: string }>(
      `/v1/management/users/${encodeURIComponent(actorId)}/roles`,
      token,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },

  revokeRole(
    token: string,
    actorId: string,
    input: { role: ManagementRole; scope_type: 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT'; scope_key: string },
  ) {
    return requestJson<{ ok: boolean; request_id: string }>(
      `/v1/management/users/${encodeURIComponent(actorId)}/roles`,
      token,
      { method: 'DELETE', body: JSON.stringify(input) },
    );
  },

  audit(token: string) {
    return requestJson<{ events: Array<Record<string, unknown>>; count: number; request_id: string }>(
      '/v1/management/audit?limit=100',
      token,
    );
  },

  usage(token: string, days = 30) {
    return requestJson<{
      days: number;
      since: string;
      by_category: Array<Record<string, unknown>>;
      by_day: Array<Record<string, unknown>>;
      request_id: string;
    }>(`/v1/management/usage?days=${days}`, token);
  },

  sessions(token: string) {
    return requestJson<{
      events: Array<Record<string, unknown>>;
      count: number;
      provider_managed_sessions: boolean;
      note: string;
      request_id: string;
    }>('/v1/management/sessions', token);
  },

  system(token: string) {
    return requestJson<Record<string, unknown>>('/v1/management/system', token);
  },

  usageEvent(token: string, category: string) {
    return requestJson<{ ok: boolean; category: string; request_id: string }>(
      '/v1/management/usage/events',
      token,
      { method: 'POST', body: JSON.stringify({ category }) },
    );
  },

  sessionEvent(token: string, eventType: 'SESSION_RESTORED' | 'PASSWORD_UPDATED' | 'SECURITY_REVIEWED') {
    return requestJson<{ ok: boolean; event_id: string; request_id: string }>(
      '/v1/management/session-events',
      token,
      { method: 'POST', body: JSON.stringify({ event_type: eventType }) },
    );
  },
};
