import { describe, expect, it, vi } from 'vitest';
import { createOperatorReadOnlyAggregator } from '../server/operatorReadOnlyAggregator';
import type {
  AuthorizedOperatorScope,
  OperatorGatewayResource,
} from '../server/operatorIdentityGateway';

const WORKER_ORIGIN = 'https://operator-worker.example/';
const API_KEY = 'server-custodied-read-key-0001';
const NOW = new Date('2026-07-21T02:30:00.000Z');

const LOCKS = {
  providerMutationAllowed: false,
  executionAllowed: false,
  withdrawalsAllowed: false,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function operator() {
  return { actorId: 'auditor-1', matchedRoles: ['AUDITOR'] };
}

function accountEvidence(status: string) {
  return {
    exchangeAccountId: 'account-1',
    productId: 'BTCUSDT',
    status,
  };
}

function responseFor(resource: OperatorGatewayResource): Response {
  if (resource === 'ACTIVATION_GATE') {
    return jsonResponse({
      environment: 'live-candidate',
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: ['candidate_build_locked'],
      evaluatedAt: '2026-07-21T02:29:00.000Z',
      operator: operator(),
    }, 503);
  }

  const common = {
    environment: 'live-candidate',
    readOnly: true,
    resource,
    operator: operator(),
    ...LOCKS,
  };

  if (resource === 'DEPLOYMENT_READINESS') {
    return jsonResponse({
      ...common,
      deploymentAllowed: false,
      demoRequestAllowed: false,
      credentialsRead: false,
      evidence: {
        status: 'BLOCKED',
        readyForNonLiveDeploymentReview: false,
        checks: { total: 14, passed: 12 },
        blockers: ['external_read_only_attestation_missing'],
        externalReadOnlyAttestationPresent: false,
        gitSha: 'a'.repeat(40),
        preparedAt: '2026-07-21T02:20:00.000Z',
        internalManifestId: 'must-not-leak',
      },
    });
  }

  if (resource === 'OPERATIONAL_REHEARSAL') {
    return jsonResponse({
      ...common,
      deploymentAllowed: false,
      demoRequestAllowed: false,
      credentialsRead: false,
      automaticRetryAllowed: false,
      accountingAutomaticallyDispatched: false,
      evidence: {
        status: 'READY_FOR_INDEPENDENT_REVIEW',
        readyForIndependentReview: true,
        checks: { total: 5, passed: 5 },
        scenarios: [{
          name: 'PROVIDER_OUTAGE_FAIL_CLOSED',
          passed: true,
          evidencePresent: true,
          observedAt: '2026-07-21T02:21:00.000Z',
          evidenceHash: 'must-not-leak',
        }],
        blockers: [],
        gitSha: 'b'.repeat(40),
        preparedAt: '2026-07-21T02:22:00.000Z',
      },
    });
  }

  if (resource === 'ALERTS') {
    return jsonResponse({
      ...common,
      evidence: [
        { exchangeAccountId: 'account-1', status: 'OPEN' },
        { exchangeAccountId: null, status: 'ACKNOWLEDGED' },
      ],
    });
  }

  if (resource === 'AUDIT_HEAD') {
    return jsonResponse({
      ...common,
      evidence: {
        exchangeAccountId: 'account-1',
        occurredAt: '2026-07-21T02:23:00.000Z',
        eventHash: 'must-not-leak',
      },
    });
  }

  const statusByResource: Readonly<Record<string, string>> = {
    CERTIFICATION: 'BLOCKED',
    RECOVERY_READINESS: 'PENDING_REVIEW',
    RECONCILIATION: 'CLEAR',
  };
  return jsonResponse({
    ...common,
    evidence: accountEvidence(statusByResource[resource]),
  });
}

function resourceFromUrl(url: URL): OperatorGatewayResource {
  const resourceByPath: Readonly<Record<string, OperatorGatewayResource>> = {
    '/v1/operator/activation-gate': 'ACTIVATION_GATE',
    '/v1/operator/deployment-readiness': 'DEPLOYMENT_READINESS',
    '/v1/operator/operational-readiness': 'OPERATIONAL_REHEARSAL',
    '/v1/operator/certification': 'CERTIFICATION',
    '/v1/operator/recovery-readiness': 'RECOVERY_READINESS',
    '/v1/operator/reconciliation': 'RECONCILIATION',
    '/v1/operator/alerts': 'ALERTS',
    '/v1/operator/audit-head': 'AUDIT_HEAD',
  };
  const resource = resourceByPath[url.pathname];
  if (!resource) throw new Error('unexpected test route');
  return resource;
}

function scope(resources: readonly OperatorGatewayResource[]): AuthorizedOperatorScope {
  const accountRequired = resources.some((resource) => [
    'CERTIFICATION',
    'RECOVERY_READINESS',
    'RECONCILIATION',
    'ALERTS',
    'AUDIT_HEAD',
  ].includes(resource));
  return {
    actorId: 'auditor-1',
    matchedRoles: ['AUDITOR'],
    visibleResources: resources,
    accountId: accountRequired ? 'account-1' : null,
    productId: accountRequired ? 'BTCUSDT' : null,
  };
}

function dependencies(fetcher = vi.fn(async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(String(input));
  return responseFor(resourceFromUrl(url));
})) {
  return {
    workerOrigin: WORKER_ORIGIN,
    fetcher,
    resolveCredential: vi.fn(async () => ({
      actorId: 'auditor-1',
      apiKey: API_KEY,
    })),
    now: () => NOW,
  };
}

describe('server-only operator read aggregator', () => {
  it('reads and minimizes all eight independently authorized resources', async () => {
    const deps = dependencies();
    const aggregate = createOperatorReadOnlyAggregator(deps);
    const visible = [
      'ACTIVATION_GATE',
      'DEPLOYMENT_READINESS',
      'OPERATIONAL_REHEARSAL',
      'CERTIFICATION',
      'RECOVERY_READINESS',
      'RECONCILIATION',
      'ALERTS',
      'AUDIT_HEAD',
    ] as const;

    const result = await aggregate(scope(visible), new AbortController().signal) as Record<string, unknown>;

    expect(deps.fetcher).toHaveBeenCalledTimes(8);
    expect(deps.resolveCredential).toHaveBeenCalledTimes(8);
    for (const [input, init] of deps.fetcher.mock.calls) {
      const url = input instanceof URL ? input : new URL(String(input));
      expect(url.origin).toBe('https://operator-worker.example');
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      expect(init?.headers).toEqual({
        Accept: 'application/json',
        'X-Operator-Id': 'auditor-1',
        'X-API-Key': API_KEY,
      });
      const resource = resourceFromUrl(url);
      if (['CERTIFICATION', 'RECOVERY_READINESS', 'RECONCILIATION'].includes(resource)) {
        expect(url.searchParams.get('account_id')).toBe('account-1');
        expect(url.searchParams.get('product_id')).toBe('BTCUSDT');
      }
      if (resource === 'ALERTS') {
        expect(url.searchParams.get('limit')).toBe('50');
      }
    }

    expect(result.activation).toEqual({
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: ['candidate_build_locked'],
      evaluatedAt: '2026-07-21T02:29:00.000Z',
    });
    expect(result.account).toEqual({
      accountId: 'account-1',
      productId: 'BTCUSDT',
      certificationStatus: 'BLOCKED',
      recoveryReadinessStatus: 'PENDING_REVIEW',
      reconciliationStatus: 'CLEAR',
      activeAlertCount: 2,
      auditHeadAt: '2026-07-21T02:23:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result.locks).toMatchObject({
      deploymentAllowed: false,
      providerMutationAllowed: false,
      executionAllowed: false,
      realFundsAllowed: false,
      withdrawalsAllowed: false,
    });
  });

  it('does not read activation evidence when it is outside the visible resource set', async () => {
    const deps = dependencies();
    const result = await createOperatorReadOnlyAggregator(deps)(
      scope(['DEPLOYMENT_READINESS']),
      new AbortController().signal,
    ) as Record<string, unknown>;

    expect(deps.fetcher).toHaveBeenCalledTimes(1);
    expect(deps.resolveCredential).toHaveBeenCalledTimes(1);
    expect(result.activation).toEqual({
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: ['activation_resource_not_visible'],
      evaluatedAt: NOW.toISOString(),
    });
  });

  it('rejects account evidence that escapes server-resolved scope', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      environment: 'live-candidate',
      readOnly: true,
      resource: 'CERTIFICATION',
      operator: operator(),
      ...LOCKS,
      evidence: {
        exchangeAccountId: 'other-account',
        productId: 'BTCUSDT',
        status: 'BLOCKED',
      },
    }));
    const deps = dependencies(fetcher);

    await expect(createOperatorReadOnlyAggregator(deps)(
      scope(['CERTIFICATION']),
      new AbortController().signal,
    )).rejects.toThrow('authorized account');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects weakened capability locks without retrying', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      environment: 'live-candidate',
      readOnly: true,
      resource: 'CERTIFICATION',
      operator: operator(),
      providerMutationAllowed: false,
      executionAllowed: true,
      withdrawalsAllowed: false,
      evidence: accountEvidence('BLOCKED'),
    }));
    const deps = dependencies(fetcher);

    await expect(createOperatorReadOnlyAggregator(deps)(
      scope(['CERTIFICATION']),
      new AbortController().signal,
    )).rejects.toThrow('read-only resource contract');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('enforces the response byte limit', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      environment: 'live-candidate',
      readOnly: true,
      resource: 'CERTIFICATION',
      operator: operator(),
      ...LOCKS,
      evidence: {
        ...accountEvidence('BLOCKED'),
        padding: 'x'.repeat(2_000),
      },
    }));
    const deps = {
      ...dependencies(fetcher),
      maxResponseBytes: 1_024,
      maxAggregateBytes: 1_024,
    };

    await expect(createOperatorReadOnlyAggregator(deps)(
      scope(['CERTIFICATION']),
      new AbortController().signal,
    )).rejects.toThrow('byte limit');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects credential scope mismatch before an upstream request', async () => {
    const deps = dependencies();
    deps.resolveCredential = vi.fn(async () => ({
      actorId: 'other-actor',
      apiKey: API_KEY,
    }));

    await expect(createOperatorReadOnlyAggregator(deps)(
      scope(['DEPLOYMENT_READINESS']),
      new AbortController().signal,
    )).rejects.toThrow('outside operator scope');
    expect(deps.fetcher).not.toHaveBeenCalled();
  });

  it('makes a single attempt when the transport fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    const deps = dependencies(fetcher);

    await expect(createOperatorReadOnlyAggregator(deps)(
      scope(['DEPLOYMENT_READINESS']),
      new AbortController().signal,
    )).rejects.toThrow('network unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
