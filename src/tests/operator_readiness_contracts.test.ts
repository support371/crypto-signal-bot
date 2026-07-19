import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  OPERATOR_READINESS_GATEWAY_PATH,
  normalizeOperatorReadinessSnapshot,
  readOperatorReadinessSnapshot,
} from '../lib/operatorReadinessApi';

function validPayload() {
  return {
    environment: 'live-candidate',
    readOnly: true,
    generatedAt: '2026-07-19T17:30:00.000Z',
    operator: {
      actorId: 'auditor-1',
      matchedRoles: ['AUDITOR'],
    },
    visibleResources: [
      'ACTIVATION_GATE',
      'DEPLOYMENT_READINESS',
      'CERTIFICATION',
      'RECOVERY_READINESS',
      'RECONCILIATION',
      'ALERTS',
      'AUDIT_HEAD',
    ],
    activation: {
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: ['candidate_build_cannot_execute_live_orders'],
      evaluatedAt: '2026-07-19T17:29:59.000Z',
    },
    deployment: {
      status: 'BLOCKED',
      readyForNonLiveDeploymentReview: false,
      checks: { total: 14, passed: 12, blocked: 2 },
      blockers: ['isolatedD1 evidence is missing', 'external attestation is missing'],
      externalReadOnlyAttestationPresent: false,
      gitSha: 'a'.repeat(40),
      preparedAt: '2026-07-19T17:20:00.000Z',
    },
    account: {
      accountId: 'account-1',
      productId: 'BTCUSDT',
      certificationStatus: 'BLOCKED',
      recoveryReadinessStatus: 'PENDING_ACCOUNTING_REVIEW',
      reconciliationStatus: 'CLEAR',
      activeAlertCount: 2,
      auditHeadAt: '2026-07-19T17:10:00.000Z',
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

describe('operator readiness normalization', () => {
  it('accepts only a server-authorized, permanently locked snapshot', () => {
    const snapshot = normalizeOperatorReadinessSnapshot(validPayload());
    expect(snapshot.gatewayStatus).toBe('available');
    expect(snapshot.environment).toBe('live-candidate');
    expect(snapshot.operator).toEqual({ actorId: 'auditor-1', matchedRoles: ['AUDITOR'] });
    expect(snapshot.visibleResources).toHaveLength(7);
    expect(snapshot.activation).toMatchObject({
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
    });
    expect(snapshot.deployment?.checks).toEqual({ total: 14, passed: 12, blocked: 2 });
    expect(snapshot.deployment?.readyForNonLiveDeploymentReview).toBe(false);
    expect(Object.values(snapshot.locks).every((value) => value === false)).toBe(true);
  });

  it.each([
    ['readOnly', false],
    ['environment', 'live'],
  ])('rejects unsafe root field %s', (field, value) => {
    const payload = validPayload() as Record<string, unknown>;
    payload[field] = value;
    const snapshot = normalizeOperatorReadinessSnapshot(payload);
    expect(snapshot.gatewayStatus).toBe('invalid_response');
    expect(snapshot.environment).toBe('unavailable');
    expect(snapshot.activation).toBeNull();
  });

  it('rejects any true mutation, execution, funding, or retry capability', () => {
    for (const key of Object.keys(validPayload().locks)) {
      const payload = validPayload();
      payload.locks = { ...payload.locks, [key]: true } as typeof payload.locks;
      const snapshot = normalizeOperatorReadinessSnapshot(payload);
      expect(snapshot.gatewayStatus, key).toBe('invalid_response');
      expect(snapshot.error, key).toContain('permanent read-only capability contract');
    }
  });

  it('does not invent deployment evidence outside the visible role scope', () => {
    const payload = validPayload();
    payload.visibleResources = ['ACTIVATION_GATE'];
    const snapshot = normalizeOperatorReadinessSnapshot(payload);
    expect(snapshot.gatewayStatus).toBe('available');
    expect(snapshot.deployment).toBeNull();
  });
});

describe('operator readiness gateway transport', () => {
  it('uses only the fixed same-origin GET contract without credential headers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validPayload()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const snapshot = await readOperatorReadinessSnapshot({ fetcher });
    expect(snapshot.gatewayStatus).toBe('available');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(OPERATOR_READINESS_GATEWAY_PATH);
    expect(url).toBe('/api/operator/readiness');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    const serialized = JSON.stringify(init);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('X-API-Key');
    expect(serialized).not.toContain('X-Operator-Id');
  });

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [503, 'not_configured'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %i to %s without fabricating evidence', async (status, expected) => {
    const snapshot = await readOperatorReadinessSnapshot({
      fetcher: vi.fn(async () => new Response(null, { status })),
    });
    expect(snapshot.gatewayStatus).toBe(expected);
    expect(snapshot.operator).toBeNull();
    expect(snapshot.deployment).toBeNull();
    expect(snapshot.account).toBeNull();
    expect(Object.values(snapshot.locks).every((value) => value === false)).toBe(true);
  });

  it('fails closed on network or parsing errors', async () => {
    const snapshot = await readOperatorReadinessSnapshot({
      fetcher: vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    });
    expect(snapshot.gatewayStatus).toBe('unavailable');
    expect(snapshot.error).toContain('No authority or status was inferred');
  });
});

describe('operator readiness browser source safety', () => {
  it('contains no browser credential storage or direct operator Worker transport', async () => {
    const [client, page, app, layout, gateway] = await Promise.all([
      readFile(new URL('../lib/operatorReadinessApi.ts', import.meta.url), 'utf8'),
      readFile(new URL('../pages/OperatorReadiness.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../AppCore.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../components/LayoutCore.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../api/operator/readiness.js', import.meta.url), 'utf8'),
    ]);
    const browserBoundary = `${client}\n${page}`;

    for (const forbidden of [
      /localStorage/i,
      /sessionStorage/i,
      /document\.cookie/i,
      /Authorization\s*:/i,
      /X-API-Key/i,
      /X-Operator-Id/i,
      /\/v1\/operator\//,
      /VITE_.*(?:OPERATOR|API_KEY|SECRET)/i,
      /credentials\s*:\s*['"]include['"]/i,
      /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    ]) {
      expect(browserBoundary).not.toMatch(forbidden);
    }

    for (const forbidden of [
      /request\.headers/i,
      /request\.body/i,
      /process\.env/i,
      /fetch\s*\(/i,
      /Authorization/i,
      /X-API-Key/i,
      /X-Operator-Id/i,
      /secret/i,
      /credential/i,
      /providerMutationAllowed:\s*true/i,
      /executionAllowed:\s*true/i,
      /withdrawalsAllowed:\s*true/i,
    ]) {
      expect(gateway).not.toMatch(forbidden);
    }

    expect(client).toContain("credentials: 'same-origin'");
    expect(client).toContain("OPERATOR_READINESS_GATEWAY_PATH = '/api/operator/readiness'");
    expect(gateway).toContain("code: 'OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED'");
    expect(gateway).toContain('sendJson(response, 503');
    expect(gateway).toContain("response.setHeader('Allow', 'GET, HEAD, OPTIONS')");
    expect(app).toContain('path="/operator-readiness"');
    expect(app).toContain('<ProtectedPage>');
    expect(layout).toContain('to="/operator-readiness"');
  });
});
