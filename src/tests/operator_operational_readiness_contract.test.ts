import { describe, expect, it } from 'vitest';
import { normalizeOperatorReadinessSnapshot } from '../lib/operatorReadinessApi';

function payload() {
  return {
    environment: 'live-candidate',
    readOnly: true,
    generatedAt: '2026-07-19T18:10:00.000Z',
    operator: { actorId: 'auditor-1', matchedRoles: ['AUDITOR'] },
    visibleResources: ['ACTIVATION_GATE', 'OPERATIONAL_REHEARSAL'],
    activation: {
      liveReady: false,
      activationEnabled: false,
      activationBlocked: true,
      realMoneyMovementAllowed: false,
      reasons: ['candidate_build_locked'],
      evaluatedAt: '2026-07-19T18:09:59.000Z',
    },
    deployment: null,
    operational: {
      status: 'BLOCKED',
      readyForIndependentReview: false,
      checks: { total: 5, passed: 4, blocked: 1 },
      scenarios: [
        { name: 'ROLLBACK_TO_KNOWN_GOOD', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:00:00.000Z', evidenceHash: 'hidden' },
        { name: 'DISASTER_RECOVERY_RESTORE', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:01:00.000Z', evidenceHash: 'hidden' },
        { name: 'ACCESS_REFERENCE_ROTATION', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:02:00.000Z', evidenceHash: 'hidden' },
        { name: 'PROVIDER_OUTAGE_FAIL_CLOSED', passed: false, evidencePresent: true, observedAt: '2026-07-19T18:03:00.000Z', evidenceHash: 'hidden' },
        { name: 'INCIDENT_ESCALATION_AND_CONTAINMENT', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:04:00.000Z', evidenceHash: 'hidden' },
      ],
      blockers: ['provider outage rehearsal is blocked'],
      gitSha: 'a'.repeat(40),
      preparedAt: '2026-07-19T18:05:00.000Z',
    },
    account: null,
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

describe('operational readiness frontend mapping', () => {
  it('maps five sanitized scenarios without retaining evidence hashes', () => {
    const snapshot = normalizeOperatorReadinessSnapshot(payload());
    expect(snapshot.gatewayStatus).toBe('available');
    expect(snapshot.visibleResources).toContain('OPERATIONAL_REHEARSAL');
    expect(snapshot.operational?.checks).toEqual({ total: 5, passed: 4, blocked: 1 });
    expect(snapshot.operational?.scenarios).toHaveLength(5);
    expect(snapshot.operational?.scenarios[3]).toEqual({
      name: 'PROVIDER_OUTAGE_FAIL_CLOSED',
      passed: false,
      evidencePresent: true,
      observedAt: '2026-07-19T18:03:00.000Z',
    });
    expect(JSON.stringify(snapshot.operational)).not.toContain('evidenceHash');
  });

  it('hides operational evidence when the resource is not visible', () => {
    const value = payload();
    value.visibleResources = ['ACTIVATION_GATE'];
    const snapshot = normalizeOperatorReadinessSnapshot(value);
    expect(snapshot.operational).toBeNull();
  });
});
