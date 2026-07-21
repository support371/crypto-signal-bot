import { describe, expect, it, vi } from 'vitest';
import { createTrustedOperatorSessionVerifier } from '../server/trustedOperatorSessionVerifier';
import type {
  SignedSessionVerificationDecision,
  TrustedOperatorSessionVerifierDependencies,
  VerifiedIdentityClaims,
} from '../server/trustedOperatorSessionVerifier';

const NOW = new Date('2026-07-21T10:00:00.000Z');

function validClaims(overrides: Partial<VerifiedIdentityClaims> = {}): VerifiedIdentityClaims {
  return {
    issuer: 'https://identity.example/',
    audience: 'crypto-signal-operator',
    subject: 'provider-subject-1',
    sessionId: 'session-0001',
    assuranceLevel: 'AAL2',
    issuedAt: '2026-07-21T09:50:00.000Z',
    authenticatedAt: '2026-07-21T09:45:00.000Z',
    notBefore: '2026-07-21T09:49:00.000Z',
    expiresAt: '2026-07-21T10:30:00.000Z',
    ...overrides,
  };
}

function verified(
  claims: VerifiedIdentityClaims = validClaims(),
): SignedSessionVerificationDecision {
  return { status: 'VERIFIED', claims };
}

function dependencies(
  overrides: Partial<TrustedOperatorSessionVerifierDependencies> = {},
): TrustedOperatorSessionVerifierDependencies {
  return {
    verifySignedSession: vi.fn(async () => verified()),
    inspectSessionState: vi.fn(async () => ({ status: 'ACTIVE' as const })),
    resolveSubject: vi.fn(async () => ({
      status: 'MAPPED' as const,
      subjectId: 'operator-subject-1',
    })),
    now: () => NOW,
    ...overrides,
  };
}

function verifier(
  deps: TrustedOperatorSessionVerifierDependencies,
  requiredAssurance: 'AAL2' | 'AAL3' = 'AAL2',
) {
  return createTrustedOperatorSessionVerifier({
    issuer: 'https://identity.example/',
    audience: 'crypto-signal-operator',
    requiredAssurance,
    maxClockSkewSeconds: 30,
    maxSessionAgeSeconds: 3_600,
    maxAuthenticationAgeSeconds: 1_800,
  }, deps);
}

describe('trusted operator session verifier foundation', () => {
  it('returns only the server-mapped subject and normalized session evidence', async () => {
    const deps = dependencies();
    const result = await verifier(deps)(
      new Request('https://app.example/api/operator/readiness'),
      new AbortController().signal,
    );

    expect(result).toEqual({
      status: 'AUTHENTICATED',
      session: {
        subjectId: 'operator-subject-1',
        assuranceLevel: 'AAL2',
        expiresAt: '2026-07-21T10:30:00.000Z',
      },
    });
    expect(deps.verifySignedSession).toHaveBeenCalledTimes(1);
    expect(deps.inspectSessionState).toHaveBeenCalledTimes(1);
    expect(deps.resolveSubject).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('provider-subject-1');
    expect(serialized).not.toContain('session-0001');
  });

  it.each([
    ['wrong issuer', { issuer: 'https://other.example/' }],
    ['wrong audience', { audience: 'other-audience' }],
    ['expired session', { expiresAt: '2026-07-21T09:59:00.000Z' }],
    ['future session', { issuedAt: '2026-07-21T10:05:00.000Z' }],
    ['future not-before', { notBefore: '2026-07-21T10:05:00.000Z' }],
    ['stale authentication', { authenticatedAt: '2026-07-21T09:00:00.000Z' }],
  ])('rejects %s claims before state or subject reads', async (_name, overrides) => {
    const deps = dependencies({
      verifySignedSession: vi.fn(async () => verified(validClaims(overrides))),
    });
    const result = await verifier(deps)(
      new Request('https://app.example/api/operator/readiness'),
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAUTHENTICATED');
    expect(deps.inspectSessionState).not.toHaveBeenCalled();
    expect(deps.resolveSubject).not.toHaveBeenCalled();
  });

  it('enforces the configured assurance level', async () => {
    const deps = dependencies();
    const result = await verifier(deps, 'AAL3')(
      new Request('https://app.example/api/operator/readiness'),
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAUTHENTICATED');
    expect(deps.inspectSessionState).not.toHaveBeenCalled();
  });

  it.each(['REVOKED', 'REPLAYED'] as const)(
    'rejects %s session state without subject mapping',
    async (status) => {
      const deps = dependencies({
        inspectSessionState: vi.fn(async () => ({ status, reason: 'state rejected' })),
      });
      const result = await verifier(deps)(
        new Request('https://app.example/api/operator/readiness'),
        new AbortController().signal,
      );

      expect(result.status).toBe('UNAUTHENTICATED');
      expect(deps.resolveSubject).not.toHaveBeenCalled();
    },
  );

  it('fails unavailable when session state cannot be checked', async () => {
    const deps = dependencies({
      inspectSessionState: vi.fn(async () => ({
        status: 'UNAVAILABLE' as const,
        reason: 'state store unavailable',
      })),
    });
    const result = await verifier(deps)(
      new Request('https://app.example/api/operator/readiness'),
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAVAILABLE');
    expect(deps.resolveSubject).not.toHaveBeenCalled();
  });

  it('rejects a disabled or unmapped operator subject', async () => {
    const deps = dependencies({
      resolveSubject: vi.fn(async () => ({
        status: 'DISABLED' as const,
        reason: 'operator disabled',
      })),
    });
    const result = await verifier(deps)(
      new Request('https://app.example/api/operator/readiness'),
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAUTHENTICATED');
  });

  it('classifies dependency exceptions as unavailable', async () => {
    const deps = dependencies({
      inspectSessionState: vi.fn(async () => {
        throw new Error('state service failed');
      }),
    });
    const result = await verifier(deps)(
      new Request('https://app.example/api/operator/readiness'),
      new AbortController().signal,
    );

    expect(result.status).toBe('UNAVAILABLE');
  });

  it('does not call dependencies for an already-aborted request', async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();
    const result = await verifier(deps)(
      new Request('https://app.example/api/operator/readiness'),
      controller.signal,
    );

    expect(result.status).toBe('UNAVAILABLE');
    expect(deps.verifySignedSession).not.toHaveBeenCalled();
    expect(deps.inspectSessionState).not.toHaveBeenCalled();
    expect(deps.resolveSubject).not.toHaveBeenCalled();
  });
});
