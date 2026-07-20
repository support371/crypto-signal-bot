import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createBoundedOperatorIdentityGateway } from '../server/boundedOperatorIdentityGateway';
import type {
  OperatorGatewayDependencies,
  OperatorSessionDecision,
} from '../server/operatorIdentityGateway';

const NOW = new Date('2026-07-20T04:00:00.000Z');

function validEvidence() {
  return {
    environment: 'live-candidate',
    readOnly: true,
    operator: { actorId: 'untrusted-actor', matchedRoles: ['VIEWER'] },
    visibleResources: ['UNTRUSTED_RESOURCE'],
    activation: {
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: ['candidate_build_locked'],
      evaluatedAt: '2026-07-20T03:59:00.000Z',
      internalReleaseId: 'must-not-leak',
    },
    deployment: {
      status: 'BLOCKED',
      readyForNonLiveDeploymentReview: false,
      checks: { total: 14, passed: 12, blocked: 999 },
      blockers: ['external review missing'],
      externalReadOnlyAttestationPresent: false,
      gitSha: 'a'.repeat(40),
      preparedAt: '2026-07-20T03:50:00.000Z',
      manifestId: 'must-not-leak',
      evidenceHashes: ['must-not-leak'],
    },
    operational: {
      status: 'BLOCKED',
      readyForIndependentReview: false,
      checks: { total: 5, passed: 4, blocked: 999 },
      scenarios: [{
        name: 'PROVIDER_OUTAGE_FAIL_CLOSED',
        passed: false,
        evidencePresent: true,
        observedAt: '2026-07-20T03:51:00.000Z',
        evidenceHash: 'must-not-leak',
      }],
      blockers: ['external observation missing'],
      gitSha: 'b'.repeat(40),
      preparedAt: '2026-07-20T03:52:00.000Z',
      packId: 'must-not-leak',
    },
    account: {
      accountId: 'account-1',
      productId: 'BTCUSDT',
      certificationStatus: 'BLOCKED',
      recoveryReadinessStatus: 'PENDING_REVIEW',
      reconciliationStatus: 'CLEAR',
      activeAlertCount: 2,
      auditHeadAt: '2026-07-20T03:53:00.000Z',
      rawBalances: ['must-not-leak'],
      rawOrders: ['must-not-leak'],
    },
    locks: {
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
    },
  };
}

function dependencies(
  overrides: Partial<OperatorGatewayDependencies> = {},
): OperatorGatewayDependencies {
  return {
    verifySession: vi.fn(async (): Promise<OperatorSessionDecision> => ({
      status: 'AUTHENTICATED',
      session: {
        subjectId: 'idp-subject-1',
        assuranceLevel: 'AAL2',
        expiresAt: '2026-07-20T05:00:00.000Z',
      },
    })),
    resolveAuthorization: vi.fn(async () => ({
      status: 'AUTHORIZED' as const,
      scope: {
        actorId: 'auditor-1',
        matchedRoles: ['AUDITOR'] as const,
        visibleResources: [
          'ACTIVATION_GATE',
          'DEPLOYMENT_READINESS',
          'OPERATIONAL_REHEARSAL',
          'CERTIFICATION',
          'RECOVERY_READINESS',
          'RECONCILIATION',
          'ALERTS',
          'AUDIT_HEAD',
        ] as const,
        accountId: 'account-1',
        productId: 'BTCUSDT',
      },
    })),
    aggregateReadOnlyEvidence: vi.fn(async () => validEvidence()),
    now: () => NOW,
    timeoutMs: 500,
    ...overrides,
  };
}

describe('operator identity gateway foundation', () => {
  it('returns a server-scoped and minimized snapshot', async () => {
    const deps = dependencies();
    const gateway = createBoundedOperatorIdentityGateway(deps);
    const response = await gateway(new Request('https://app.example/api/operator/readiness'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json() as Record<string, unknown>;
    expect(body.operator).toEqual({ actorId: 'auditor-1', matchedRoles: ['AUDITOR'] });
    expect(body.visibleResources).toHaveLength(8);
    expect(body.generatedAt).toBe(NOW.toISOString());
    expect(body.locks).toEqual({
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
    expect((body.deployment as Record<string, unknown>).checks).toEqual({
      total: 14,
      passed: 12,
      blocked: 2,
    });
    expect((body.operational as Record<string, unknown>).checks).toEqual({
      total: 5,
      passed: 4,
      blocked: 1,
    });
    const serialized = JSON.stringify(body);
    for (const hidden of [
      'untrusted-actor',
      'UNTRUSTED_RESOURCE',
      'manifestId',
      'evidenceHashes',
      'evidenceHash',
      'packId',
      'rawBalances',
      'rawOrders',
      'must-not-leak',
    ]) {
      expect(serialized).not.toContain(hidden);
    }
    expect(deps.verifySession).toHaveBeenCalledTimes(1);
    expect(deps.resolveAuthorization).toHaveBeenCalledTimes(1);
    expect(deps.aggregateReadOnlyEvidence).toHaveBeenCalledTimes(1);
  });

  it.each(['Authorization', 'X-API-Key', 'X-Operator-Id']) (
    'rejects browser authority header %s before session verification',
    async (header) => {
      const deps = dependencies();
      const gateway = createBoundedOperatorIdentityGateway(deps);
      const response = await gateway(new Request('https://app.example/api/operator/readiness', {
        headers: { [header]: 'browser-supplied-value' },
      }));
      expect(response.status).toBe(400);
      expect((await response.json() as Record<string, unknown>).code)
        .toBe('BROWSER_AUTHORITY_HEADERS_FORBIDDEN');
      expect(deps.verifySession).not.toHaveBeenCalled();
      expect(deps.resolveAuthorization).not.toHaveBeenCalled();
      expect(deps.aggregateReadOnlyEvidence).not.toHaveBeenCalled();
    },
  );

  it('returns 401 without calling authorization or evidence aggregation', async () => {
    const deps = dependencies({
      verifySession: vi.fn(async () => ({
        status: 'UNAUTHENTICATED' as const,
        reason: 'missing trusted session',
      })),
    });
    const response = await createBoundedOperatorIdentityGateway(deps)(
      new Request('https://app.example/api/operator/readiness'),
    );
    expect(response.status).toBe(401);
    expect(deps.resolveAuthorization).not.toHaveBeenCalled();
    expect(deps.aggregateReadOnlyEvidence).not.toHaveBeenCalled();
  });

  it('returns 403 without reading evidence when server-side scope is forbidden', async () => {
    const deps = dependencies({
      resolveAuthorization: vi.fn(async () => ({
        status: 'FORBIDDEN' as const,
        reason: 'role not allowed',
      })),
    });
    const response = await createBoundedOperatorIdentityGateway(deps)(
      new Request('https://app.example/api/operator/readiness'),
    );
    expect(response.status).toBe(403);
    expect(deps.aggregateReadOnlyEvidence).not.toHaveBeenCalled();
  });

  it('fails closed when evidence weakens a permanent capability', async () => {
    const unsafe = validEvidence();
    unsafe.locks.executionAllowed = true as false;
    const deps = dependencies({
      aggregateReadOnlyEvidence: vi.fn(async () => unsafe),
    });
    const response = await createBoundedOperatorIdentityGateway(deps)(
      new Request('https://app.example/api/operator/readiness'),
    );
    expect(response.status).toBe(503);
    expect((await response.json() as Record<string, unknown>).code)
      .toBe('OPERATOR_GATEWAY_EVIDENCE_INVALID');
  });

  it('fails closed when account evidence escapes server-resolved scope', async () => {
    const escaped = validEvidence();
    escaped.account.accountId = 'account-2';
    const deps = dependencies({
      aggregateReadOnlyEvidence: vi.fn(async () => escaped),
    });
    const response = await createBoundedOperatorIdentityGateway(deps)(
      new Request('https://app.example/api/operator/readiness'),
    );
    expect(response.status).toBe(503);
    expect((await response.json() as Record<string, unknown>).code)
      .toBe('OPERATOR_GATEWAY_EVIDENCE_INVALID');
  });

  it('does not retry a failed evidence aggregation', async () => {
    const aggregate = vi.fn(async () => {
      throw new Error('upstream unavailable');
    });
    const deps = dependencies({ aggregateReadOnlyEvidence: aggregate });
    const response = await createBoundedOperatorIdentityGateway(deps)(
      new Request('https://app.example/api/operator/readiness'),
    );
    expect(response.status).toBe(503);
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it('enforces the deadline even when a dependency never settles', async () => {
    const deps = dependencies({
      aggregateReadOnlyEvidence: vi.fn(() => new Promise(() => undefined)),
      timeoutMs: 100,
    });
    const started = Date.now();
    const response = await createBoundedOperatorIdentityGateway(deps)(
      new Request('https://app.example/api/operator/readiness'),
    );
    expect(response.status).toBe(503);
    expect((await response.json() as Record<string, unknown>).code)
      .toBe('OPERATOR_GATEWAY_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(deps.aggregateReadOnlyEvidence).toHaveBeenCalledTimes(1);
  });

  it('supports HEAD and OPTIONS while denying write methods', async () => {
    const deps = dependencies();
    const gateway = createBoundedOperatorIdentityGateway(deps);

    const head = await gateway(new Request('https://app.example/api/operator/readiness', {
      method: 'HEAD',
    }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const options = await gateway(new Request('https://app.example/api/operator/readiness', {
      method: 'OPTIONS',
    }));
    expect(options.status).toBe(204);
    expect(options.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');

    const post = await gateway(new Request('https://app.example/api/operator/readiness', {
      method: 'POST',
    }));
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('keeps the production endpoint fail-closed and disconnected', async () => {
    const [placeholder, foundation] = await Promise.all([
      readFile(new URL('../../api/operator/readiness.js', import.meta.url), 'utf8'),
      readFile(new URL('../server/operatorIdentityGateway.ts', import.meta.url), 'utf8'),
    ]);
    expect(placeholder).toContain("code: 'OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED'");
    expect(placeholder).toContain('sendJson(response, 503');
    expect(placeholder).not.toContain('operatorIdentityGateway');
    expect(placeholder).not.toContain('boundedOperatorIdentityGateway');
    expect(foundation).not.toMatch(/\bfetch\s*\(/i);
    expect(foundation).not.toMatch(/process\.env/i);
    expect(foundation).not.toMatch(/localStorage|sessionStorage|document\.cookie/i);
  });
});
