import {
  OPERATOR_GATEWAY_RESOURCES,
  OPERATOR_GATEWAY_ROLES,
  type AuthorizedOperatorScope,
  type OperatorAuthorizationDecision,
  type OperatorGatewayResource,
  type OperatorGatewayRole,
  type VerifiedOperatorSession,
} from './operatorIdentityGateway';

export type OperatorRoleScopeType = 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT';

export interface OperatorRoleAssignment {
  role: OperatorGatewayRole;
  scopeType: OperatorRoleScopeType;
  scopeKey: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ServerOperatorAccessProfile {
  subjectId: string;
  actorId: string;
  status: 'ACTIVE' | 'DISABLED';
  exchangeName: string;
  accountId: string | null;
  productId: string | null;
  requestedResources: readonly OperatorGatewayResource[];
  assignments: readonly OperatorRoleAssignment[];
}

export type OperatorAccessProfileDecision =
  | { status: 'FOUND'; profile: ServerOperatorAccessProfile }
  | { status: 'NOT_FOUND'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export interface OperatorAuthorizationResolverDependencies {
  loadAccessProfile(
    subjectId: string,
    signal: AbortSignal,
  ): Promise<OperatorAccessProfileDecision>;
  now?: () => Date;
}

type NormalizedAssignment = Readonly<OperatorRoleAssignment & {
  expiresAtMs: number | null;
}>;

type NormalizedProfile = Readonly<Omit<ServerOperatorAccessProfile, 'assignments' | 'requestedResources'> & {
  assignments: readonly NormalizedAssignment[];
  requestedResources: readonly OperatorGatewayResource[];
}>;

const RESOURCE_SET = new Set<string>(OPERATOR_GATEWAY_RESOURCES);
const ROLE_SET = new Set<string>(OPERATOR_GATEWAY_ROLES);
const GLOBAL_ONLY_RESOURCES = new Set<OperatorGatewayResource>([
  'ACTIVATION_GATE',
  'DEPLOYMENT_READINESS',
  'OPERATIONAL_REHEARSAL',
]);
const ACCOUNT_RESOURCES = new Set<OperatorGatewayResource>([
  'CERTIFICATION',
  'RECOVERY_READINESS',
  'RECONCILIATION',
  'ALERTS',
  'AUDIT_HEAD',
]);
const RESOURCE_ROLES: Readonly<Record<OperatorGatewayResource, readonly OperatorGatewayRole[]>> = Object.freeze({
  ACTIVATION_GATE: Object.freeze(['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  DEPLOYMENT_READINESS: Object.freeze(['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  OPERATIONAL_REHEARSAL: Object.freeze(['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  CERTIFICATION: Object.freeze(['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  RECOVERY_READINESS: Object.freeze(['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  RECONCILIATION: Object.freeze(['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  ALERTS: Object.freeze(['VIEWER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
  AUDIT_HEAD: Object.freeze(['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']),
});

function boundedText(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${field} is missing or exceeds its limit`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maximum = 256): string | null {
  if (value === null) return null;
  return boundedText(value, field, maximum);
}

function canonicalIso(value: unknown, field: string): Readonly<{ value: string; time: number }> {
  const normalized = boundedText(value, field, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new TypeError(`${field} must be a canonical ISO timestamp`);
  }
  return Object.freeze({ value: normalized, time: parsed });
}

function normalizeResources(value: readonly OperatorGatewayResource[]): readonly OperatorGatewayResource[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > OPERATOR_GATEWAY_RESOURCES.length) {
    throw new TypeError('requestedResources has an invalid count');
  }
  const resources: OperatorGatewayResource[] = [];
  for (const resource of value) {
    if (!RESOURCE_SET.has(resource) || resources.includes(resource)) {
      throw new TypeError('requestedResources contains an invalid or duplicate resource');
    }
    resources.push(resource);
  }
  return Object.freeze(resources);
}

function normalizeAssignment(
  value: OperatorRoleAssignment,
  index: number,
): NormalizedAssignment {
  if (!ROLE_SET.has(value.role)) throw new TypeError(`assignments[${index}].role is invalid`);
  if (value.scopeType !== 'GLOBAL' && value.scopeType !== 'EXCHANGE' && value.scopeType !== 'ACCOUNT') {
    throw new TypeError(`assignments[${index}].scopeType is invalid`);
  }
  const scopeKey = boundedText(value.scopeKey, `assignments[${index}].scopeKey`, 256);
  const expiresAt = value.expiresAt === null
    ? null
    : canonicalIso(value.expiresAt, `assignments[${index}].expiresAt`);
  const revokedAt = value.revokedAt === null
    ? null
    : canonicalIso(value.revokedAt, `assignments[${index}].revokedAt`).value;
  if (value.scopeType === 'GLOBAL' && scopeKey !== '*') {
    throw new TypeError(`assignments[${index}] global scopeKey must be *`);
  }
  return Object.freeze({
    role: value.role,
    scopeType: value.scopeType,
    scopeKey,
    expiresAt: expiresAt?.value ?? null,
    revokedAt,
    expiresAtMs: expiresAt?.time ?? null,
  });
}

function normalizeProfile(
  profile: ServerOperatorAccessProfile,
  session: VerifiedOperatorSession,
): NormalizedProfile {
  const subjectId = boundedText(profile.subjectId, 'profile.subjectId');
  if (subjectId !== session.subjectId) {
    throw new TypeError('operator profile escaped the verified subject');
  }
  if (profile.status !== 'ACTIVE' && profile.status !== 'DISABLED') {
    throw new TypeError('operator profile status is invalid');
  }
  const actorId = boundedText(profile.actorId, 'profile.actorId');
  const exchangeName = boundedText(profile.exchangeName, 'profile.exchangeName', 64).toUpperCase();
  const accountId = optionalText(profile.accountId, 'profile.accountId');
  const productId = optionalText(profile.productId, 'profile.productId', 128)?.toUpperCase() ?? null;
  const requestedResources = normalizeResources(profile.requestedResources);
  if (requestedResources.some((resource) => ACCOUNT_RESOURCES.has(resource)) && !accountId) {
    throw new TypeError('account resources require a server-resolved account');
  }
  if (productId && !accountId) throw new TypeError('product scope requires an account scope');
  if (!Array.isArray(profile.assignments) || profile.assignments.length === 0 || profile.assignments.length > 100) {
    throw new TypeError('operator role assignments have an invalid count');
  }
  const assignments = profile.assignments.map(normalizeAssignment);
  const keys = new Set<string>();
  for (const assignment of assignments) {
    const key = `${assignment.role}\u0000${assignment.scopeType}\u0000${assignment.scopeKey}`;
    if (keys.has(key)) throw new TypeError('operator role assignments contain duplicates');
    keys.add(key);
  }
  return Object.freeze({
    subjectId,
    actorId,
    status: profile.status,
    exchangeName,
    accountId,
    productId,
    requestedResources,
    assignments: Object.freeze(assignments),
  });
}

function assignmentMatches(
  assignment: NormalizedAssignment,
  resource: OperatorGatewayResource,
  profile: NormalizedProfile,
  nowMs: number,
): boolean {
  if (assignment.revokedAt !== null) return false;
  if (assignment.expiresAtMs !== null && assignment.expiresAtMs <= nowMs) return false;
  if (!RESOURCE_ROLES[resource].includes(assignment.role)) return false;
  if (GLOBAL_ONLY_RESOURCES.has(resource)) {
    return assignment.scopeType === 'GLOBAL';
  }
  if (assignment.scopeType === 'GLOBAL') return true;
  if (assignment.scopeType === 'EXCHANGE') {
    return assignment.scopeKey.toUpperCase() === profile.exchangeName;
  }
  return profile.accountId !== null && assignment.scopeKey === profile.accountId;
}

function authorizeProfile(
  profile: NormalizedProfile,
  nowMs: number,
): OperatorAuthorizationDecision {
  if (profile.status !== 'ACTIVE') {
    return Object.freeze({ status: 'FORBIDDEN', reason: 'operator profile is disabled' });
  }

  const matchedRoles: OperatorGatewayRole[] = [];
  for (const resource of profile.requestedResources) {
    const matching = profile.assignments.filter((assignment) => (
      assignmentMatches(assignment, resource, profile, nowMs)
    ));
    if (matching.length === 0) {
      return Object.freeze({
        status: 'FORBIDDEN',
        reason: 'operator role or scope does not authorize every requested resource',
      });
    }
    for (const assignment of matching) {
      if (!matchedRoles.includes(assignment.role)) matchedRoles.push(assignment.role);
    }
  }

  const scope: AuthorizedOperatorScope = Object.freeze({
    actorId: profile.actorId,
    matchedRoles: Object.freeze(matchedRoles),
    visibleResources: profile.requestedResources,
    accountId: profile.accountId,
    productId: profile.productId,
  });
  return Object.freeze({ status: 'AUTHORIZED', scope });
}

function unavailable(reason: string): OperatorAuthorizationDecision {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

export function createOperatorAuthorizationResolver(
  dependencies: OperatorAuthorizationResolverDependencies,
): (session: VerifiedOperatorSession, signal: AbortSignal) => Promise<OperatorAuthorizationDecision> {
  const now = dependencies.now ?? (() => new Date());

  return async (
    session: VerifiedOperatorSession,
    signal: AbortSignal,
  ): Promise<OperatorAuthorizationDecision> => {
    if (signal.aborted) return unavailable('operator authorization was aborted');

    let decision: OperatorAccessProfileDecision;
    try {
      decision = await dependencies.loadAccessProfile(session.subjectId, signal);
    } catch {
      return signal.aborted
        ? unavailable('operator authorization was aborted')
        : unavailable('operator access profile is unavailable');
    }
    if (decision.status === 'NOT_FOUND') {
      return Object.freeze({ status: 'FORBIDDEN', reason: 'operator access profile was not found' });
    }
    if (decision.status === 'UNAVAILABLE') {
      return unavailable('operator access profile is unavailable');
    }
    if (signal.aborted) return unavailable('operator authorization was aborted');

    let nowMs: number;
    try {
      nowMs = now().getTime();
      if (!Number.isFinite(nowMs)) throw new TypeError('invalid clock');
    } catch {
      return unavailable('operator authorization clock is unavailable');
    }

    try {
      return authorizeProfile(normalizeProfile(decision.profile, session), nowMs);
    } catch {
      return unavailable('operator access profile is malformed');
    }
  };
}
