import { describe, expect, it, vi } from 'vitest';
import { createDisconnectedOperatorGatewayFoundation } from '../server/operatorGatewayFoundation';
import type { OperatorGatewayFoundationDependencies } from '../server/operatorGatewayFoundation';

const NOW = new Date('2026-07-21T11:00:00.000Z');
const WORKER_ORIGIN = 'https://operator-worker.example/';
const API_KEY = 'server-custodied-read-key-0001';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function dependencies(): OperatorGatewayFoundationDependencies {
  return {
    now: () => NOW,
    session: {
      verifySignedSession: vi.fn(async () => ({
        status: 'VERIFIED' as const,
        claims: {
          issuer: 'https://identity.example/',
          audience: 'crypto-signal-operator',
          subject: 'provider-subject-1',
          sessionId: 'session-1',
          assuranceLevel: 'AAL2' as const,
          issuedAt: '2026-07-21T10:50:00.000Z',
          authenticatedAt: '2026-07-21T10:45:00.000Z',
          notBefore: '2026-07-21T10:49:00.000Z',
          expiresAt: '2026-07-21T11:30:00.000Z',
        },
      })),
      inspectSessionState: vi.fn(async () => ({ status: 'ACTIVE' as const })),
      resolveSubject: vi.fn(async () => ({
        status: 'MAPPED' as const,
        subjectId: 'operator-subject-1',
      })),
    },
    authorization: {
      loadAccessProfile: vi.fn(async () => ({
        status: 'FOUND' as const,
        profile: {
          subjectId: 'operator-subject-1',
          actorId: 'auditor-1',
          status: 'ACTIVE' as const,
          exchangeName: 'BITGET',
          accountId: null,
          productId: null,
          requestedResources: ['ACTIVATION_GATE', 'DEPLOYMENT_READINESS'] as const,
          assignments: [{
            role: 'AUDITOR' as const,
            scopeType: 'GLOBAL' as const,
            scopeKey: '*',
            expiresAt: null,
            revokedAt: null,
          }],
        },
      })),
    },
    evidence: {
      workerOrigin: WORKER_ORIGIN,
      resolveCredential: vi.fn(async () => ({
        actorId: 'auditor-1',
        apiKey: API_KEY,
      })),
      fetcher: vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input : new URL(String(input));
        if (url.pathname === '/v1/operator/activation-gate') {
          return json({
            environment: 'live-candidate',
            liveReady: false,
            activationEnabled: false,
            activationBlocked: true,
            realMoneyMovementAllowed: false,
            reasons: ['candidate_build_locked'],
            evaluatedAt: '2026-07-21T10:59:00.000Z',
            operator: { actorId: 'auditor-1', matchedRoles: ['AUDITOR'] },
          }, 503);
        }
        return json({
          environment: 'live-candidate',
          readOnly: true,
          resource: 'DEPLOYMENT_READINESS',
          operator: { actorId: 'auditor-1', matchedRoles: ['AUDITOR'] },
          evidence: {
            status: 'BLOCKED',
            readyForNonLiveDeploymentReview: false,
            checks: { total: 14, passed: 12 },
            blockers: ['external_review_missing'],
            externalReadOnlyAttestationPresent: false,
            gitSha: 'a'.repeat(40),
            preparedAt: '2026-07-21T10:58:00.000Z',
          },
          deploymentAllowed: false,
          demoRequestAllowed: false,
          credentialsRead: false,
          providerMutationAllowed: false,
          executionAllowed: false,
          withdrawalsAllowed: false,
        });
      }),
    },
  };
}

function gateway(deps: OperatorGatewayFoundationDependencies) {
  return createDisconnectedOperatorGatewayFoundation({
    session: {
      issuer: 'https://identity.example/',
      audience: 'crypto-signal-operator',
      requiredAssurance: 'AAL2',
      maxClockSkewSeconds: 30,
      maxSessionAgeSeconds: 3_600,
      maxAuthenticationAgeSeconds: 1_800,
    },
    timeoutMs: 1_000,
  }, deps);
}

describe('disconnected operator gateway composition', () => {
  it('composes trusted session, authorization, aggregation, and response minimization', async () => {
    const deps = dependencies();
    const response = await gateway(deps)(new Request('https://app.example/api/operator/readiness'));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.operator).toEqual({ actorId: 'auditor-1', matchedRoles: ['AUDITOR'] });
    expect(body.visibleResources).toEqual(['ACTIVATION_GATE', 'DEPLOYMENT_READINESS']);
    expect(body.account).toBeNull();
    expect(body.locks).toMatchObject({
      providerMutationAllowed: false,
      executionAllowed: false,
      realFundsAllowed: false,
      withdrawalsAllowed: false,
    });
    expect(deps.session.verifySignedSession).toHaveBeenCalledTimes(1);
    expect(deps.authorization.loadAccessProfile).toHaveBeenCalledTimes(1);
    expect(deps.evidence.resolveCredential).toHaveBeenCalledTimes(2);
    expect(deps.evidence.fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops before authorization and evidence when session verification fails', async () => {
    const deps = dependencies();
    deps.session.verifySignedSession = vi.fn(async () => ({
      status: 'UNAUTHENTICATED' as const,
      reason: 'no trusted session',
    }));
    const response = await gateway(deps)(new Request('https://app.example/api/operator/readiness'));

    expect(response.status).toBe(401);
    expect(deps.authorization.loadAccessProfile).not.toHaveBeenCalled();
    expect(deps.evidence.fetcher).not.toHaveBeenCalled();
  });

  it('stops before evidence when the full server-owned resource set is not authorized', async () => {
    const deps = dependencies();
    deps.authorization.loadAccessProfile = vi.fn(async () => ({
      status: 'FOUND' as const,
      profile: {
        subjectId: 'operator-subject-1',
        actorId: 'viewer-1',
        status: 'ACTIVE' as const,
        exchangeName: 'BITGET',
        accountId: null,
        productId: null,
        requestedResources: ['DEPLOYMENT_READINESS'] as const,
        assignments: [{
          role: 'VIEWER' as const,
          scopeType: 'GLOBAL' as const,
          scopeKey: '*',
          expiresAt: null,
          revokedAt: null,
        }],
      },
    }));
    const response = await gateway(deps)(new Request('https://app.example/api/operator/readiness'));

    expect(response.status).toBe(403);
    expect(deps.evidence.resolveCredential).not.toHaveBeenCalled();
    expect(deps.evidence.fetcher).not.toHaveBeenCalled();
  });

  it('fails closed without retry when upstream evidence is unavailable', async () => {
    const deps = dependencies();
    deps.evidence.fetcher = vi.fn(async () => {
      throw new Error('worker unavailable');
    });
    const response = await gateway(deps)(new Request('https://app.example/api/operator/readiness'));

    expect(response.status).toBe(503);
    expect(deps.evidence.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['Authorization', 'X-API-Key', 'X-Operator-Id'])(
    'rejects browser authority header %s before all dependencies',
    async (header) => {
      const deps = dependencies();
      const response = await gateway(deps)(new Request(
        'https://app.example/api/operator/readiness',
        { headers: { [header]: 'browser-value' } },
      ));

      expect(response.status).toBe(400);
      expect(deps.session.verifySignedSession).not.toHaveBeenCalled();
      expect(deps.authorization.loadAccessProfile).not.toHaveBeenCalled();
      expect(deps.evidence.fetcher).not.toHaveBeenCalled();
    },
  );
});
