export const OPERATOR_READINESS_GATEWAY_PATH = '/api/operator/readiness';

export type OperatorGatewayStatus =
  | 'available'
  | 'not_configured'
  | 'unauthenticated'
  | 'forbidden'
  | 'unavailable'
  | 'invalid_response';

export type OperatorResource =
  | 'ACTIVATION_GATE'
  | 'DEPLOYMENT_READINESS'
  | 'CERTIFICATION'
  | 'RECOVERY_READINESS'
  | 'RECONCILIATION'
  | 'ALERTS'
  | 'AUDIT_HEAD';

type JsonRecord = Record<string, unknown>;

export interface OperatorCapabilityLocks {
  deploymentAllowed: false;
  demoRequestAllowed: false;
  credentialsRead: false;
  providerMutationAllowed: false;
  executionAllowed: false;
  liveExecutionAllowed: false;
  realFundsAllowed: false;
  mainnetAllowed: false;
  withdrawalsAllowed: false;
  automaticRetryAllowed: false;
  accountingAutomaticallyDispatched: false;
}

export interface OperatorIdentitySummary {
  actorId: string;
  matchedRoles: string[];
}

export interface OperatorActivationSummary {
  liveReady: false;
  activationEnabled: false;
  activationBlocked: true;
  realMoneyMovementAllowed: false;
  reasons: string[];
  evaluatedAt: string | null;
}

export interface OperatorDeploymentSummary {
  status: 'BLOCKED' | 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW';
  readyForNonLiveDeploymentReview: boolean;
  checks: {
    total: number;
    passed: number;
    blocked: number;
  };
  blockers: string[];
  externalReadOnlyAttestationPresent: boolean;
  gitSha: string | null;
  preparedAt: string | null;
}

export interface OperatorAccountSummary {
  accountId: string;
  productId: string | null;
  certificationStatus: string | null;
  recoveryReadinessStatus: string | null;
  reconciliationStatus: string | null;
  activeAlertCount: number | null;
  auditHeadAt: string | null;
}

export interface OperatorReadinessSnapshot {
  gatewayStatus: OperatorGatewayStatus;
  generatedAt: string;
  environment: 'live-candidate' | 'unavailable';
  readOnly: true;
  operator: OperatorIdentitySummary | null;
  visibleResources: OperatorResource[];
  activation: OperatorActivationSummary | null;
  deployment: OperatorDeploymentSummary | null;
  account: OperatorAccountSummary | null;
  locks: OperatorCapabilityLocks;
  error: string | null;
}

export interface OperatorReadinessFetchOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

const LOCKS: OperatorCapabilityLocks = Object.freeze({
  deploymentAllowed: false,
  demoRequestAllowed: false,
  credentialsRead: false,
  providerMutationAllowed: false,
  executionAllowed: false,
  liveExecutionAllowed: false,
  realFundsAllowed: false,
  mainnetAllowed: false,
  withdrawalsAllowed: false,
  automaticRetryAllowed: false,
  accountingAutomaticallyDispatched: false,
});

const RESOURCE_SET = new Set<OperatorResource>([
  'ACTIVATION_GATE',
  'DEPLOYMENT_READINESS',
  'CERTIFICATION',
  'RECOVERY_READINESS',
  'RECONCILIATION',
  'ALERTS',
  'AUDIT_HEAD',
]);

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item))
    .filter((item): item is string => item !== null)
    .slice(0, limit);
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function hasPermanentFalseLocks(record: JsonRecord): boolean {
  return Object.keys(LOCKS).every((key) => record[key] === false);
}

export function createUnavailableOperatorSnapshot(
  gatewayStatus: Exclude<OperatorGatewayStatus, 'available'>,
  error: string,
): OperatorReadinessSnapshot {
  return Object.freeze({
    gatewayStatus,
    generatedAt: new Date().toISOString(),
    environment: 'unavailable',
    readOnly: true,
    operator: null,
    visibleResources: Object.freeze([]) as OperatorResource[],
    activation: null,
    deployment: null,
    account: null,
    locks: LOCKS,
    error,
  });
}

export function normalizeOperatorReadinessSnapshot(value: unknown): OperatorReadinessSnapshot {
  const root = asRecord(value);
  const operatorRecord = asRecord(root.operator);
  const activationRecord = asRecord(root.activation);
  const deploymentRecord = asRecord(root.deployment);
  const accountRecord = asRecord(root.account);
  const lockRecord = asRecord(root.locks);

  const unsafe = root.readOnly !== true
    || root.environment !== 'live-candidate'
    || activationRecord.liveReady !== false
    || activationRecord.activationEnabled !== false
    || activationRecord.activationBlocked !== true
    || activationRecord.realMoneyMovementAllowed !== false
    || !hasPermanentFalseLocks(lockRecord);
  if (unsafe) {
    return createUnavailableOperatorSnapshot(
      'invalid_response',
      'Operator gateway evidence failed the permanent read-only capability contract.',
    );
  }

  const actorId = stringValue(operatorRecord.actorId);
  const matchedRoles = stringArray(operatorRecord.matchedRoles, 12);
  if (!actorId || matchedRoles.length === 0) {
    return createUnavailableOperatorSnapshot(
      'invalid_response',
      'Operator gateway did not provide an authenticated role summary.',
    );
  }

  const visibleResources = stringArray(root.visibleResources, 7)
    .filter((item): item is OperatorResource => RESOURCE_SET.has(item as OperatorResource));
  const total = safeInteger(asRecord(deploymentRecord.checks).total) ?? 0;
  const passed = Math.min(total, safeInteger(asRecord(deploymentRecord.checks).passed) ?? 0);
  const blocked = Math.max(0, total - passed);
  const deploymentStatus = deploymentRecord.status === 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
    ? 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
    : 'BLOCKED';

  return Object.freeze({
    gatewayStatus: 'available',
    generatedAt: stringValue(root.generatedAt) ?? new Date().toISOString(),
    environment: 'live-candidate',
    readOnly: true,
    operator: Object.freeze({ actorId, matchedRoles: Object.freeze(matchedRoles) as string[] }),
    visibleResources: Object.freeze(visibleResources),
    activation: Object.freeze({
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: Object.freeze(stringArray(activationRecord.reasons, 30)) as string[],
      evaluatedAt: stringValue(activationRecord.evaluatedAt),
    }),
    deployment: visibleResources.includes('DEPLOYMENT_READINESS')
      ? Object.freeze({
          status: deploymentStatus,
          readyForNonLiveDeploymentReview:
            deploymentStatus === 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
            && deploymentRecord.readyForNonLiveDeploymentReview === true,
          checks: Object.freeze({ total, passed, blocked }),
          blockers: Object.freeze(stringArray(deploymentRecord.blockers, 14)) as string[],
          externalReadOnlyAttestationPresent:
            deploymentRecord.externalReadOnlyAttestationPresent === true,
          gitSha: stringValue(deploymentRecord.gitSha),
          preparedAt: stringValue(deploymentRecord.preparedAt),
        })
      : null,
    account: stringValue(accountRecord.accountId)
      ? Object.freeze({
          accountId: stringValue(accountRecord.accountId)!,
          productId: stringValue(accountRecord.productId),
          certificationStatus: stringValue(accountRecord.certificationStatus),
          recoveryReadinessStatus: stringValue(accountRecord.recoveryReadinessStatus),
          reconciliationStatus: stringValue(accountRecord.reconciliationStatus),
          activeAlertCount: safeInteger(accountRecord.activeAlertCount),
          auditHeadAt: stringValue(accountRecord.auditHeadAt),
        })
      : null,
    locks: LOCKS,
    error: null,
  });
}

function mapGatewayFailure(status: number): OperatorReadinessSnapshot {
  if (status === 401) {
    return createUnavailableOperatorSnapshot('unauthenticated', 'Trusted operator session is required.');
  }
  if (status === 403) {
    return createUnavailableOperatorSnapshot('forbidden', 'The current server-side role cannot view this evidence.');
  }
  if (status === 503) {
    return createUnavailableOperatorSnapshot('not_configured', 'Trusted operator identity gateway is not configured.');
  }
  return createUnavailableOperatorSnapshot('unavailable', `Operator gateway returned HTTP ${status}.`);
}

export async function readOperatorReadinessSnapshot(
  options: OperatorReadinessFetchOptions = {},
): Promise<OperatorReadinessSnapshot> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(OPERATOR_READINESS_GATEWAY_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    if (!response.ok) return mapGatewayFailure(response.status);
    return normalizeOperatorReadinessSnapshot(await response.json());
  } catch {
    return createUnavailableOperatorSnapshot(
      'unavailable',
      'Operator gateway is unavailable. No authority or status was inferred in the browser.',
    );
  }
}
