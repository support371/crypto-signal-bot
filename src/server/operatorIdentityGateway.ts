export const OPERATOR_GATEWAY_RESOURCES = Object.freeze([
  'ACTIVATION_GATE',
  'DEPLOYMENT_READINESS',
  'OPERATIONAL_REHEARSAL',
  'CERTIFICATION',
  'RECOVERY_READINESS',
  'RECONCILIATION',
  'ALERTS',
  'AUDIT_HEAD',
] as const);

export const OPERATOR_GATEWAY_ROLES = Object.freeze([
  'VIEWER',
  'RISK_OPERATOR',
  'RISK_ADMIN',
  'AUDITOR',
  'RELEASE_ADMIN',
] as const);

export type OperatorGatewayResource = typeof OPERATOR_GATEWAY_RESOURCES[number];
export type OperatorGatewayRole = typeof OPERATOR_GATEWAY_ROLES[number];
export type OperatorAssuranceLevel = 'AAL2' | 'AAL3';

export interface VerifiedOperatorSession {
  subjectId: string;
  assuranceLevel: OperatorAssuranceLevel;
  expiresAt: string;
}

export type OperatorSessionDecision =
  | { status: 'AUTHENTICATED'; session: VerifiedOperatorSession }
  | { status: 'UNAUTHENTICATED'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export interface AuthorizedOperatorScope {
  actorId: string;
  matchedRoles: readonly OperatorGatewayRole[];
  visibleResources: readonly OperatorGatewayResource[];
  accountId: string | null;
  productId: string | null;
}

export type OperatorAuthorizationDecision =
  | { status: 'AUTHORIZED'; scope: AuthorizedOperatorScope }
  | { status: 'FORBIDDEN'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export interface OperatorGatewayDependencies {
  verifySession(request: Request, signal: AbortSignal): Promise<OperatorSessionDecision>;
  resolveAuthorization(
    session: VerifiedOperatorSession,
    signal: AbortSignal,
  ): Promise<OperatorAuthorizationDecision>;
  aggregateReadOnlyEvidence(
    scope: AuthorizedOperatorScope,
    signal: AbortSignal,
  ): Promise<unknown>;
  now?: () => Date;
  timeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

const RESOURCE_SET = new Set<string>(OPERATOR_GATEWAY_RESOURCES);
const ROLE_SET = new Set<string>(OPERATOR_GATEWAY_ROLES);
const ACCOUNT_RESOURCES = new Set<OperatorGatewayResource>([
  'CERTIFICATION',
  'RECOVERY_READINESS',
  'RECONCILIATION',
  'ALERTS',
  'AUDIT_HEAD',
]);

const LOCKS = Object.freeze({
  deploymentAllowed: false as const,
  demoRequestAllowed: false as const,
  credentialsRead: false as const,
  providerMutationAllowed: false as const,
  executionAllowed: false as const,
  liveExecutionAllowed: false as const,
  realFundsAllowed: false as const,
  mainnetAllowed: false as const,
  withdrawalsAllowed: false as const,
  automaticRetryAllowed: false as const,
  accountingAutomaticallyDispatched: false as const,
});

const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Operator-Gateway': 'server-verified-foundation',
});

class GatewayContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayContractError';
  }
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function textArray(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value
    .map((item) => text(item))
    .filter((item): item is string => item !== null)
    .slice(0, limit));
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function canonicalIso(value: unknown): string | null {
  const normalized = text(value, 64);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === normalized ? normalized : null;
}

function exactGitSha(value: unknown): string | null {
  const normalized = text(value, 64)?.toLowerCase() ?? null;
  return normalized && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(normalized)
    ? normalized
    : null;
}

function uniqueAllowedResources(value: readonly OperatorGatewayResource[]): readonly OperatorGatewayResource[] {
  const result: OperatorGatewayResource[] = [];
  for (const resource of value) {
    if (!RESOURCE_SET.has(resource) || result.includes(resource)) {
      throw new GatewayContractError('authorization contains an invalid resource set');
    }
    result.push(resource);
  }
  if (result.length === 0 || result.length > OPERATOR_GATEWAY_RESOURCES.length) {
    throw new GatewayContractError('authorization contains an invalid resource count');
  }
  return Object.freeze(result);
}

function uniqueAllowedRoles(value: readonly OperatorGatewayRole[]): readonly OperatorGatewayRole[] {
  const result: OperatorGatewayRole[] = [];
  for (const role of value) {
    if (!ROLE_SET.has(role) || result.includes(role)) {
      throw new GatewayContractError('authorization contains an invalid role set');
    }
    result.push(role);
  }
  if (result.length === 0 || result.length > OPERATOR_GATEWAY_ROLES.length) {
    throw new GatewayContractError('authorization contains an invalid role count');
  }
  return Object.freeze(result);
}

function validateScope(scope: AuthorizedOperatorScope): AuthorizedOperatorScope {
  const actorId = text(scope.actorId, 128);
  if (!actorId) throw new GatewayContractError('authorized actor ID is missing');
  const matchedRoles = uniqueAllowedRoles(scope.matchedRoles);
  const visibleResources = uniqueAllowedResources(scope.visibleResources);
  const requiresAccount = visibleResources.some((resource) => ACCOUNT_RESOURCES.has(resource));
  const accountId = scope.accountId === null ? null : text(scope.accountId, 128);
  const productId = scope.productId === null ? null : text(scope.productId, 128);
  if (requiresAccount && !accountId) {
    throw new GatewayContractError('account-scoped resources require a server-resolved account');
  }
  return Object.freeze({ actorId, matchedRoles, visibleResources, accountId, productId });
}

function validateSession(session: VerifiedOperatorSession, now: Date): VerifiedOperatorSession {
  const subjectId = text(session.subjectId, 128);
  const expiresAt = canonicalIso(session.expiresAt);
  if (!subjectId || !expiresAt) throw new GatewayContractError('verified session is malformed');
  if (session.assuranceLevel !== 'AAL2' && session.assuranceLevel !== 'AAL3') {
    throw new GatewayContractError('verified session assurance is insufficient');
  }
  if (Date.parse(expiresAt) <= now.getTime()) {
    throw new GatewayContractError('verified session is expired');
  }
  return Object.freeze({ subjectId, assuranceLevel: session.assuranceLevel, expiresAt });
}

function hasPermanentLocks(value: unknown): boolean {
  const record = asRecord(value);
  return Object.keys(LOCKS).every((key) => record[key] === false);
}

function checkCounts(value: unknown): Readonly<{ total: number; passed: number; blocked: number }> {
  const record = asRecord(value);
  const total = nonNegativeInteger(record.total) ?? 0;
  const passed = Math.min(total, nonNegativeInteger(record.passed) ?? 0);
  return Object.freeze({ total, passed, blocked: Math.max(0, total - passed) });
}

function sanitizeDeployment(value: unknown): unknown {
  const record = asRecord(value);
  const status = record.status === 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
    ? 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
    : 'BLOCKED';
  return Object.freeze({
    status,
    readyForNonLiveDeploymentReview:
      status === 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
      && record.readyForNonLiveDeploymentReview === true,
    checks: checkCounts(record.checks),
    blockers: textArray(record.blockers, 14),
    externalReadOnlyAttestationPresent: record.externalReadOnlyAttestationPresent === true,
    gitSha: exactGitSha(record.gitSha),
    preparedAt: canonicalIso(record.preparedAt),
  });
}

function sanitizeOperational(value: unknown): unknown {
  const record = asRecord(value);
  const status = record.status === 'READY_FOR_INDEPENDENT_REVIEW'
    ? 'READY_FOR_INDEPENDENT_REVIEW'
    : 'BLOCKED';
  const scenarios = Array.isArray(record.scenarios)
    ? record.scenarios.slice(0, 5).map((item) => {
        const scenario = asRecord(item);
        return Object.freeze({
          name: text(scenario.name, 128) ?? 'INVALID_SCENARIO',
          passed: scenario.passed === true,
          evidencePresent: scenario.evidencePresent === true,
          observedAt: canonicalIso(scenario.observedAt),
        });
      })
    : [];
  return Object.freeze({
    status,
    readyForIndependentReview:
      status === 'READY_FOR_INDEPENDENT_REVIEW'
      && record.readyForIndependentReview === true,
    checks: checkCounts(record.checks),
    scenarios: Object.freeze(scenarios),
    blockers: textArray(record.blockers, 5),
    gitSha: exactGitSha(record.gitSha),
    preparedAt: canonicalIso(record.preparedAt),
  });
}

function sanitizeAccount(value: unknown, scope: AuthorizedOperatorScope): unknown {
  if (!scope.accountId) return null;
  const record = asRecord(value);
  if (text(record.accountId, 128) !== scope.accountId) {
    throw new GatewayContractError('aggregated account evidence escaped the authorized scope');
  }
  const productId = text(record.productId, 128);
  if (scope.productId !== null && productId !== scope.productId) {
    throw new GatewayContractError('aggregated product evidence escaped the authorized scope');
  }
  return Object.freeze({
    accountId: scope.accountId,
    productId,
    certificationStatus: text(record.certificationStatus, 128),
    recoveryReadinessStatus: text(record.recoveryReadinessStatus, 128),
    reconciliationStatus: text(record.reconciliationStatus, 128),
    activeAlertCount: nonNegativeInteger(record.activeAlertCount),
    auditHeadAt: canonicalIso(record.auditHeadAt),
  });
}

function sanitizeSnapshot(
  value: unknown,
  scope: AuthorizedOperatorScope,
  now: Date,
): unknown {
  const root = asRecord(value);
  const activation = asRecord(root.activation);
  if (
    root.environment !== 'live-candidate'
    || root.readOnly !== true
    || activation.liveReady !== false
    || activation.activationEnabled !== false
    || activation.activationBlocked !== true
    || activation.realMoneyMovementAllowed !== false
    || !hasPermanentLocks(root.locks)
  ) {
    throw new GatewayContractError('aggregated evidence violates the permanent read-only contract');
  }

  const visible = scope.visibleResources;
  const accountVisible = visible.some((resource) => ACCOUNT_RESOURCES.has(resource));
  return Object.freeze({
    environment: 'live-candidate',
    readOnly: true,
    generatedAt: now.toISOString(),
    operator: Object.freeze({
      actorId: scope.actorId,
      matchedRoles: scope.matchedRoles,
    }),
    visibleResources: visible,
    activation: Object.freeze({
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: textArray(activation.reasons, 30),
      evaluatedAt: canonicalIso(activation.evaluatedAt),
    }),
    deployment: visible.includes('DEPLOYMENT_READINESS')
      ? sanitizeDeployment(root.deployment)
      : null,
    operational: visible.includes('OPERATIONAL_REHEARSAL')
      ? sanitizeOperational(root.operational)
      : null,
    account: accountVisible ? sanitizeAccount(root.account, scope) : null,
    locks: LOCKS,
  });
}

function response(status: number, payload: unknown, suppressBody = false): Response {
  return new Response(suppressBody ? null : JSON.stringify(payload), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  suppressBody: boolean,
): Response {
  return response(status, Object.freeze({
    error: message,
    code,
    readOnly: true,
    ...LOCKS,
  }), suppressBody);
}

function containsBrowserAuthorityHeaders(request: Request): boolean {
  return request.headers.has('Authorization')
    || request.headers.has('X-API-Key')
    || request.headers.has('X-Operator-Id');
}

export function createOperatorIdentityGateway(
  dependencies: OperatorGatewayDependencies,
): (request: Request) => Promise<Response> {
  const timeoutMs = dependencies.timeoutMs ?? 2_500;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new TypeError('timeoutMs must be between 100 and 10000 milliseconds');
  }
  const now = dependencies.now ?? (() => new Date());

  return async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...RESPONSE_HEADERS,
          Allow: 'GET, HEAD, OPTIONS',
        },
      });
    }
    const suppressBody = method === 'HEAD';
    if (method !== 'GET' && method !== 'HEAD') {
      const denied = errorResponse(
        405,
        'OPERATOR_GATEWAY_READ_ONLY',
        'Operator gateway is read only',
        suppressBody,
      );
      denied.headers.set('Allow', 'GET, HEAD, OPTIONS');
      return denied;
    }
    if (containsBrowserAuthorityHeaders(request)) {
      return errorResponse(
        400,
        'BROWSER_AUTHORITY_HEADERS_FORBIDDEN',
        'Browser-supplied operator authority is not accepted',
        suppressBody,
      );
    }

    const controller = new AbortController();
    const abortFromRequest = () => controller.abort('request_aborted');
    if (request.signal.aborted) abortFromRequest();
    else request.signal.addEventListener('abort', abortFromRequest, { once: true });
    const timer = setTimeout(() => controller.abort('gateway_deadline_exceeded'), timeoutMs);

    try {
      const evaluatedAt = now();
      const sessionDecision = await dependencies.verifySession(request, controller.signal);
      if (sessionDecision.status === 'UNAUTHENTICATED') {
        return errorResponse(401, 'OPERATOR_SESSION_REQUIRED', 'Trusted operator session is required', suppressBody);
      }
      if (sessionDecision.status === 'UNAVAILABLE') {
        return errorResponse(503, 'OPERATOR_IDENTITY_UNAVAILABLE', 'Operator identity verification is unavailable', suppressBody);
      }
      const session = validateSession(sessionDecision.session, evaluatedAt);
      const authorizationDecision = await dependencies.resolveAuthorization(session, controller.signal);
      if (authorizationDecision.status === 'FORBIDDEN') {
        return errorResponse(403, 'OPERATOR_SCOPE_FORBIDDEN', 'Operator role or scope is not authorized', suppressBody);
      }
      if (authorizationDecision.status === 'UNAVAILABLE') {
        return errorResponse(503, 'OPERATOR_AUTHORIZATION_UNAVAILABLE', 'Operator authorization is unavailable', suppressBody);
      }
      const scope = validateScope(authorizationDecision.scope);
      const evidence = await dependencies.aggregateReadOnlyEvidence(scope, controller.signal);
      if (controller.signal.aborted) {
        return errorResponse(503, 'OPERATOR_GATEWAY_TIMEOUT', 'Operator evidence deadline exceeded', suppressBody);
      }
      return response(200, sanitizeSnapshot(evidence, scope, evaluatedAt), suppressBody);
    } catch {
      const code = controller.signal.aborted
        ? 'OPERATOR_GATEWAY_TIMEOUT'
        : 'OPERATOR_GATEWAY_EVIDENCE_INVALID';
      const message = controller.signal.aborted
        ? 'Operator evidence deadline exceeded'
        : 'Operator evidence is unavailable or invalid';
      return errorResponse(503, code, message, suppressBody);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abortFromRequest);
    }
  };
}
