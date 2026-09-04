import { describe, expect, it, vi } from 'vitest';
import { createOperatorAuthorizationResolver } from '../server/operatorAuthorizationResolver';
import type {
  OperatorAuthorizationResolverDependencies,
  OperatorRoleAssignment,
  ServerOperatorAccessProfile,
} from '../server/operatorAuthorizationResolver';
import type { VerifiedOperatorSession } from '../server/operatorIdentityGateway';

const NOW = new Date('2026-07-21T10:30:00.000Z');
const SESSION: VerifiedOperatorSession = {
  subjectId: 'operator-subject-1',
  assuranceLevel: 'AAL2',
  expiresAt: '2026-07-21T11:00:00.000Z',
};

function assignment(
  overrides: Partial<OperatorRoleAssignment> = {},
): OperatorRoleAssignment {
  return {
    role: 'RISK_ADMIN',
    scopeType: 'GLOBAL',
    scopeKey: '*',
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function profile(
  overrides: Partial<ServerOperatorAccessProfile> = {},
): ServerOperatorAccessProfile {
  return {
    subjectId: 'operator-subject-1',
    actorId: 'auditor-1',
    status: 'ACTIVE',
    exchangeName: 'BITGET',
    accountId: 'account-1',
    productId: 'BTCUSDT',
    requestedResources: [
      'ACTIVATION_GATE',
      'DEPLOYMENT_READINESS',
      'OPERATIONAL_REHEARSAL',
      'CERTIFICATION',
      'RECOVERY_READINESS',
      'RECONCILIATION',
      'ALERTS',
      'AUDIT_HEAD',
    ],
    assignments: [assignment()],
    ...overrides,
  };
}

function dependencies(
  accessProfile: ServerOperatorAccessProfile = profile(),
  overrides: Partial<OperatorAuthorizationResolverDependencies> = {},
): OperatorAuthorizationResolverDependencies {
  return {
    loadAccessProfile: vi.fn(async () => ({
      status: 'FOUND' as const,
      profile: accessProfile,
    })),
    now: () => NOW,
    ...overrides,
  };
}

describe('server operator authorization resolver foundation', () => {
  it('authorizes all eight resources from a server-owned global risk-admin assignment', async () => {
    const deps = dependencies();
    const result = await createOperatorAuthorizationResolver(deps)(
      SESSION,
      new AbortController().signal,
    );

    expect(result).toEqual({
      status: 'AUTHORIZED',
      scope: {
        actorId: 'auditor-1',
        matchedRoles: ['RISK_ADMIN'],
        visibleResources: [
          'ACTIVATION_GATE',
          'DEPLOYMENT_READINESS',
          'OPERATIONAL_REHEARSAL',
          'CERTIFICATION',
          'RECOVERY_READINESS',
          'RECONCILIATION',
          'ALERTS',
          'AUDIT_HEAD',
        ],
        accountId: 'account-1',
        productId: 'BTCUSDT',
      },
    });
    expect(deps.loadAccessProfile).toHaveBeenCalledWith(
      'operator-subject-1',
      expect.any(AbortSignal),
    );
  });

  it('permits an account viewer only for viewer-readable account resources', async () => {
    const accessProfile = profile({
      requestedResources: ['CERTIFICATION', 'RECOVERY_READINESS', 'RECONCILIATION', 'ALERTS'],
      assignments: [assignment({
        role: 'VIEWER',
        scopeType: 'ACCOUNT',
        scopeKey: 'account-1',
      })],
    });
    const result = await createOperatorAuthorizationResolver(dependencies(accessProfile))(
      SESSION,
      new AbortController().signal,
    );

    expect(result.status).toBe('AUTHORIZED');
    if (result.status === 'AUTHORIZED') {
      expect(result.scope.matchedRoles).toEqual(['VIEWER']);
      expect(result.scope.visibleResources).toEqual(accessProfile.requestedResources);
    }
  });

  it('does not return a partial scope when one requested resource is forbidden', async () => {
    const accessProfile = profile({
      requestedResources: ['CERTIFICATION', 'AUDIT_HEAD'],
      assignments: [assignment({
        role: 'VIEWER',
        scopeType: 'ACCOUNT',
        scopeKey: 'account-1',
      })],
    });
    const result = await createOperatorAuthorizationResolver(dependencies(accessProfile))(
      SESSION,
      new AbortController().signal,
    );

    expect(result.status).toBe('FORBIDDEN');
    expect(result).not.toHaveProperty('scope');
  });

  it('allows exchange scope for account reads but not global readiness resources', async () => {
    const exchangeRole = assignment({
      role: 'AUDITOR',
      scopeType: 'EXCHANGE',
      scopeKey: 'bitget',
    });
    const accountResult = await createOperatorAuthorizationResolver(dependencies(profile({
      requestedResources: ['CERTIFICATION', 'AUDIT_HEAD'],
      assignments: [exchangeRole],
    })))(SESSION, new AbortController().signal);
    expect(accountResult.status).toBe('AUTHORIZED');

    const globalResult = await createOperatorAuthorizationResolver(dependencies(profile({
      requestedResources: ['DEPLOYMENT_READINESS'],
      accountId: null,
      productId: null,
      assignments: [exchangeRole],
    })))(SESSION, new AbortController().signal);
    expect(globalResult.status).toBe('FORBIDDEN');
  });

  it('ignores expired and revoked assignments', async () => {
    const accessProfile = profile({
      requestedResources: ['CERTIFICATION'],
      assignments: [
        assignment({
          role: 'VIEWER',
          scopeType: 'ACCOUNT',
          scopeKey: 'account-1',
          expiresAt: '2026-07-21T10:29:00.000Z',
        }),
        assignment({
          role: 'AUDITOR',
          scopeType: 'ACCOUNT',
          scopeKey: 'account-1',
          revokedAt: '2026-07-21T10:00:00.000Z',
        }),
      ],
    });
    const result = await createOperatorAuthorizationResolver(dependencies(accessProfile))(
      SESSION,
      new AbortController().signal,
    );

    expect(result.status).toBe('FORBIDDEN');
  });

  it.each(['DISABLED', 'NOT_FOUND'] as const)(
    'rejects %s operator access without an evidence scope',
    async (state) => {
      const deps = state === 'DISABLED'
        ? dependencies(profile({ status: 'DISABLED' }))
        : dependencies(profile(), {
            loadAccessProfile: vi.fn(async () => ({
              status: 'NOT_FOUND' as const,
              reason: 'no mapping',
            })),
          });
      const result = await createOperatorAuthorizationResolver(deps)(
        SESSION,
        new AbortController().signal,
      );

      expect(result.status).toBe('FORBIDDEN');
      expect(result).not.toHaveProperty('scope');
    },
  );

  it.each([
    ['subject mismatch', profile({ subjectId: 'other-subject' })],
    ['duplicate resource', profile({ requestedResources: ['CERTIFICATION', 'CERTIFICATION'] })],
    ['duplicate assignment', profile({ assignments: [assignment(), assignment()] })],
    ['product without account', profile({
      requestedResources: ['DEPLOYMENT_READINESS'],
      accountId: null,
      productId: 'BTCUSDT',
    })],
    ['malformed expiry', profile({ assignments: [assignment({ expiresAt: 'not-a-date' })] })],
  ])('fails unavailable for malformed server profile: %s', async (_name, accessProfile) => {
    const result = await createOperatorAuthorizationResolver(dependencies(accessProfile))(
      SESSION,
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAVAILABLE');
  });

  it('fails unavailable when the profile store throws', async () => {
    const deps = dependencies(profile(), {
      loadAccessProfile: vi.fn(async () => {
        throw new Error('profile store unavailable');
      }),
    });
    const result = await createOperatorAuthorizationResolver(deps)(
      SESSION,
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAVAILABLE');
  });

  it('does not read the profile store for an already-aborted request', async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();
    const result = await createOperatorAuthorizationResolver(deps)(SESSION, controller.signal);

    expect(result.status).toBe('UNAVAILABLE');
    expect(deps.loadAccessProfile).not.toHaveBeenCalled();
  });
});
