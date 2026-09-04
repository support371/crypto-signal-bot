import type {
  AuthorizedOperatorScope,
  OperatorGatewayResource,
} from './operatorIdentityGateway';

export interface OperatorReadCredential {
  actorId: string;
  apiKey: string;
}

export interface OperatorCredentialRequest {
  actorId: string;
  resource: OperatorGatewayResource;
  accountId: string | null;
  productId: string | null;
}

export interface OperatorReadOnlyAggregatorDependencies {
  workerOrigin: string;
  fetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  resolveCredential(
    request: OperatorCredentialRequest,
    signal: AbortSignal,
  ): Promise<OperatorReadCredential>;
  maxResponseBytes?: number;
  maxAggregateBytes?: number;
  alertLimit?: number;
  now?: () => Date;
}

type JsonRecord = Record<string, unknown>;

const ROUTES: Readonly<Record<OperatorGatewayResource, string>> = Object.freeze({
  ACTIVATION_GATE: '/v1/operator/activation-gate',
  DEPLOYMENT_READINESS: '/v1/operator/deployment-readiness',
  OPERATIONAL_REHEARSAL: '/v1/operator/operational-readiness',
  CERTIFICATION: '/v1/operator/certification',
  RECOVERY_READINESS: '/v1/operator/recovery-readiness',
  RECONCILIATION: '/v1/operator/reconciliation',
  ALERTS: '/v1/operator/alerts',
  AUDIT_HEAD: '/v1/operator/audit-head',
});

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

class OperatorAggregationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorAggregationError';
  }
}

function asRecord(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperatorAggregationError('operator response is not a JSON object');
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function boundedText(value: unknown, maxLength = 256): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function boundedInteger(value: unknown, maximum: number): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= maximum
    ? value
    : null;
}

function validateOrigin(value: string): URL {
  const origin = new URL(value);
  if (
    origin.protocol !== 'https:'
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
  ) {
    throw new TypeError('workerOrigin must be an exact credential-free HTTPS origin');
  }
  return origin;
}

function validateLimit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new TypeError(`limit must be between ${minimum} and ${maximum}`);
  }
  return candidate;
}

function validateCredential(
  credential: OperatorReadCredential,
  scope: AuthorizedOperatorScope,
): OperatorReadCredential {
  const actorId = boundedText(credential.actorId, 128);
  const apiKey = boundedText(credential.apiKey, 4_096);
  if (!actorId || actorId !== scope.actorId || !apiKey || apiKey.length < 16) {
    throw new OperatorAggregationError('server credential is unavailable or outside operator scope');
  }
  return Object.freeze({ actorId, apiKey });
}

function buildUrl(
  origin: URL,
  resource: OperatorGatewayResource,
  scope: AuthorizedOperatorScope,
  alertLimit: number,
): URL {
  const url = new URL(ROUTES[resource], origin);
  if (ACCOUNT_RESOURCES.has(resource)) {
    if (!scope.accountId) {
      throw new OperatorAggregationError('account resource requires a server-resolved account');
    }
    url.searchParams.set('account_id', scope.accountId);
    if (scope.productId && resource !== 'ALERTS' && resource !== 'AUDIT_HEAD') {
      url.searchParams.set('product_id', scope.productId);
    }
    if (resource === 'ALERTS') url.searchParams.set('limit', String(alertLimit));
  }
  if (url.origin !== origin.origin) {
    throw new OperatorAggregationError('operator route escaped the approved Worker origin');
  }
  return url;
}

function validateOperator(root: JsonRecord, scope: AuthorizedOperatorScope): void {
  const operator = asRecord(root.operator);
  if (boundedText(operator.actorId, 128) !== scope.actorId) {
    throw new OperatorAggregationError('upstream operator identity does not match the authorized scope');
  }
}

function validateBaseEnvelope(
  resource: OperatorGatewayResource,
  root: JsonRecord,
  scope: AuthorizedOperatorScope,
): void {
  if (root.environment !== 'live-candidate') {
    throw new OperatorAggregationError('upstream environment is not the disabled live candidate');
  }
  validateOperator(root, scope);

  if (resource === 'ACTIVATION_GATE') {
    if (
      root.activationEnabled !== false
      || root.activationBlocked !== true
      || root.realMoneyMovementAllowed !== false
      || root.liveReady !== false
    ) {
      throw new OperatorAggregationError('activation evidence weakens the permanent lock');
    }
    return;
  }

  if (
    root.readOnly !== true
    || root.resource !== resource
    || root.providerMutationAllowed !== false
    || root.executionAllowed !== false
    || root.withdrawalsAllowed !== false
  ) {
    throw new OperatorAggregationError('upstream evidence violates the read-only resource contract');
  }

  if (resource === 'DEPLOYMENT_READINESS' && (
    root.deploymentAllowed !== false
    || root.demoRequestAllowed !== false
    || root.credentialsRead !== false
  )) {
    throw new OperatorAggregationError('deployment evidence weakens the permanent lock');
  }

  if (resource === 'OPERATIONAL_REHEARSAL' && (
    root.deploymentAllowed !== false
    || root.demoRequestAllowed !== false
    || root.credentialsRead !== false
    || root.automaticRetryAllowed !== false
    || root.accountingAutomaticallyDispatched !== false
  )) {
    throw new OperatorAggregationError('operational evidence weakens the permanent lock');
  }
}

function verifyAccountEvidence(
  resource: OperatorGatewayResource,
  evidence: unknown,
  scope: AuthorizedOperatorScope,
): void {
  if (!ACCOUNT_RESOURCES.has(resource) || evidence === null) return;
  if (!scope.accountId) {
    throw new OperatorAggregationError('account resource lacks authorized account scope');
  }

  if (resource === 'ALERTS') {
    if (!Array.isArray(evidence)) {
      throw new OperatorAggregationError('alert evidence is malformed');
    }
    for (const item of evidence) {
      const alert = asRecord(item);
      const accountId = alert.exchangeAccountId;
      if (accountId !== null && boundedText(accountId, 128) !== scope.accountId) {
        throw new OperatorAggregationError('alert evidence escaped the authorized account');
      }
    }
    return;
  }

  const record = asRecord(evidence);
  if (boundedText(record.exchangeAccountId, 128) !== scope.accountId) {
    throw new OperatorAggregationError('upstream evidence escaped the authorized account');
  }
  if (
    scope.productId
    && resource !== 'AUDIT_HEAD'
    && boundedText(record.productId, 128) !== scope.productId
  ) {
    throw new OperatorAggregationError('upstream evidence escaped the authorized product');
  }
}

async function readJsonWithinBudget(
  response: Response,
  perResponseLimit: number,
  aggregateBudget: { used: number; limit: number },
): Promise<JsonRecord> {
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new OperatorAggregationError('operator response is not JSON');
  }
  const declaredLength = Number(response.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > perResponseLimit) {
    throw new OperatorAggregationError('operator response exceeds its byte limit');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > perResponseLimit) {
    throw new OperatorAggregationError('operator response exceeds its byte limit');
  }
  aggregateBudget.used += bytes.byteLength;
  if (aggregateBudget.used > aggregateBudget.limit) {
    throw new OperatorAggregationError('aggregate operator response exceeds its byte limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new OperatorAggregationError('operator response contains invalid JSON');
  }
  return asRecord(parsed);
}

async function readResource(
  dependencies: OperatorReadOnlyAggregatorDependencies,
  origin: URL,
  resource: OperatorGatewayResource,
  scope: AuthorizedOperatorScope,
  signal: AbortSignal,
  perResponseLimit: number,
  aggregateBudget: { used: number; limit: number },
  alertLimit: number,
): Promise<readonly [OperatorGatewayResource, JsonRecord]> {
  if (signal.aborted) throw new OperatorAggregationError('operator aggregation was aborted');
  const credential = validateCredential(await dependencies.resolveCredential({
    actorId: scope.actorId,
    resource,
    accountId: scope.accountId,
    productId: scope.productId,
  }, signal), scope);
  const url = buildUrl(origin, resource, scope, alertLimit);
  const response = await dependencies.fetcher(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Operator-Id': credential.actorId,
      'X-API-Key': credential.apiKey,
    },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  if (response.redirected) {
    throw new OperatorAggregationError('operator response redirected');
  }
  if (response.url && new URL(response.url).origin !== origin.origin) {
    throw new OperatorAggregationError('operator response escaped the approved Worker origin');
  }
  const expectedStatus = resource === 'ACTIVATION_GATE' ? 503 : 200;
  if (response.status !== expectedStatus) {
    throw new OperatorAggregationError('operator resource returned an unexpected status');
  }
  const root = await readJsonWithinBudget(response, perResponseLimit, aggregateBudget);
  validateBaseEnvelope(resource, root, scope);
  verifyAccountEvidence(resource, root.evidence, scope);
  return Object.freeze([resource, root] as const);
}

function evidenceStatus(root: JsonRecord | undefined): string | null {
  return boundedText(optionalRecord(root?.evidence)?.status, 128);
}

function minimizedChecks(value: unknown): Readonly<{ total: number; passed: number }> {
  const checks = optionalRecord(value);
  const total = boundedInteger(checks?.total, 10_000) ?? 0;
  const passed = Math.min(total, boundedInteger(checks?.passed, 10_000) ?? 0);
  return Object.freeze({ total, passed });
}

function minimizedTextArray(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value
    .map((item) => boundedText(item, 512))
    .filter((item): item is string => item !== null)
    .slice(0, limit));
}

function minimizedDeployment(root: JsonRecord | undefined): unknown {
  const evidence = optionalRecord(root?.evidence);
  if (!evidence) return null;
  return Object.freeze({
    status: boundedText(evidence.status, 128),
    readyForNonLiveDeploymentReview: evidence.readyForNonLiveDeploymentReview === true,
    checks: minimizedChecks(evidence.checks),
    blockers: minimizedTextArray(evidence.blockers, 14),
    externalReadOnlyAttestationPresent: evidence.externalReadOnlyAttestationPresent === true,
    gitSha: boundedText(evidence.gitSha, 64),
    preparedAt: boundedText(evidence.preparedAt, 64),
  });
}

function minimizedOperational(root: JsonRecord | undefined): unknown {
  const evidence = optionalRecord(root?.evidence);
  if (!evidence) return null;
  const scenarios = Array.isArray(evidence.scenarios)
    ? evidence.scenarios.slice(0, 5).map((item) => {
        const scenario = optionalRecord(item);
        return Object.freeze({
          name: boundedText(scenario?.name, 128),
          passed: scenario?.passed === true,
          evidencePresent: scenario?.evidencePresent === true,
          observedAt: boundedText(scenario?.observedAt, 64),
        });
      })
    : [];
  return Object.freeze({
    status: boundedText(evidence.status, 128),
    readyForIndependentReview: evidence.readyForIndependentReview === true,
    checks: minimizedChecks(evidence.checks),
    scenarios: Object.freeze(scenarios),
    blockers: minimizedTextArray(evidence.blockers, 5),
    gitSha: boundedText(evidence.gitSha, 64),
    preparedAt: boundedText(evidence.preparedAt, 64),
  });
}

export function createOperatorReadOnlyAggregator(
  dependencies: OperatorReadOnlyAggregatorDependencies,
): (scope: AuthorizedOperatorScope, signal: AbortSignal) => Promise<unknown> {
  const origin = validateOrigin(dependencies.workerOrigin);
  const perResponseLimit = validateLimit(dependencies.maxResponseBytes, 65_536, 1_024, 262_144);
  const aggregateLimit = validateLimit(dependencies.maxAggregateBytes, 262_144, perResponseLimit, 1_048_576);
  const alertLimit = validateLimit(dependencies.alertLimit, 50, 1, 50);
  const now = dependencies.now ?? (() => new Date());

  return async (scope: AuthorizedOperatorScope, signal: AbortSignal): Promise<unknown> => {
    const resources = [...scope.visibleResources];
    if (new Set(resources).size !== resources.length) {
      throw new OperatorAggregationError('visible resource set contains duplicates');
    }
    const aggregateBudget = { used: 0, limit: aggregateLimit };
    const entries = await Promise.all(resources.map((resource) => readResource(
      dependencies,
      origin,
      resource,
      scope,
      signal,
      perResponseLimit,
      aggregateBudget,
      alertLimit,
    )));
    const byResource = new Map<OperatorGatewayResource, JsonRecord>(entries);
    const activationRoot = byResource.get('ACTIVATION_GATE');
    const activation = activationRoot ?? Object.freeze({
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: Object.freeze(['activation_resource_not_visible']),
      evaluatedAt: now().toISOString(),
    });

    const alertsEvidence = byResource.get('ALERTS')?.evidence;
    const auditEvidence = optionalRecord(byResource.get('AUDIT_HEAD')?.evidence);
    const accountVisible = resources.some((resource) => ACCOUNT_RESOURCES.has(resource));

    return Object.freeze({
      environment: 'live-candidate',
      readOnly: true,
      activation: Object.freeze({
        liveReady: false,
        activationEnabled: false,
        activationBlocked: true,
        realMoneyMovementAllowed: false,
        reasons: activationRoot?.reasons ?? (activation as JsonRecord).reasons,
        evaluatedAt: activationRoot?.evaluatedAt ?? (activation as JsonRecord).evaluatedAt,
      }),
      deployment: minimizedDeployment(byResource.get('DEPLOYMENT_READINESS')),
      operational: minimizedOperational(byResource.get('OPERATIONAL_REHEARSAL')),
      account: accountVisible ? Object.freeze({
        accountId: scope.accountId,
        productId: scope.productId,
        certificationStatus: evidenceStatus(byResource.get('CERTIFICATION')),
        recoveryReadinessStatus: evidenceStatus(byResource.get('RECOVERY_READINESS')),
        reconciliationStatus: evidenceStatus(byResource.get('RECONCILIATION')),
        activeAlertCount: Array.isArray(alertsEvidence)
          ? boundedInteger(alertsEvidence.length, alertLimit)
          : null,
        auditHeadAt: boundedText(auditEvidence?.occurredAt, 64),
      }) : null,
      locks: LOCKS,
    });
  };
}
