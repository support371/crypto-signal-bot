import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OperatorGatewayStatus,
  OperatorReadinessSnapshot,
  readOperatorReadinessSnapshot,
} from '../lib/operatorReadinessApi';

const gatewayLabels: Record<OperatorGatewayStatus, string> = {
  available: 'server-authorized read access',
  not_configured: 'identity gateway not configured',
  unauthenticated: 'trusted session required',
  forbidden: 'role not authorized',
  unavailable: 'gateway unavailable',
  invalid_response: 'unsafe response rejected',
};

const gatewayClasses: Record<OperatorGatewayStatus, string> = {
  available: 'bg-emerald-100 text-emerald-800',
  not_configured: 'bg-amber-100 text-amber-800',
  unauthenticated: 'bg-amber-100 text-amber-800',
  forbidden: 'bg-red-100 text-red-800',
  unavailable: 'bg-red-100 text-red-800',
  invalid_response: 'bg-red-100 text-red-800',
};

function Badge({ status }: { status: OperatorGatewayStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${gatewayClasses[status]}`}>
      {gatewayLabels[status]}
    </span>
  );
}

function LockRow({ label, locked }: { label: string; locked: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-secondary-600">{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${locked ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
        {locked ? 'locked' : 'unsafe'}
      </span>
    </div>
  );
}

function TextState({ value }: { value: string | null }) {
  return <span className="text-sm font-semibold text-secondary-900">{value ?? 'Not reported'}</span>;
}

function formatTime(value: string | null): string {
  if (!value) return 'Not reported';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Invalid timestamp rejected';
}

export default function OperatorReadiness() {
  const [snapshot, setSnapshot] = useState<OperatorReadinessSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setSnapshot(await readOperatorReadinessSnapshot());
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void readOperatorReadinessSnapshot({ signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) {
        setSnapshot(next);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, []);

  const allLocksHeld = useMemo(() => {
    if (!snapshot) return true;
    return Object.values(snapshot.locks).every((value) => value === false);
  }, [snapshot]);

  if (!snapshot && loading) {
    return (
      <main className="min-h-screen bg-secondary-50 p-4 md:p-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-secondary-200 bg-white p-8 text-center text-secondary-600 shadow-sm">
          Loading sanitized operator evidence…
        </div>
      </main>
    );
  }

  if (!snapshot) return null;

  return (
    <main className="min-h-screen bg-secondary-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-secondary-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-secondary-900">Operator Readiness</h1>
                <Badge status={snapshot.gatewayStatus} />
              </div>
              <p className="mt-2 max-w-3xl text-sm text-secondary-600">
                Server-authorized, read-only evidence for the disabled live candidate. This page cannot submit orders,
                activate deployment, read exchange credentials, move funds, or authorize a release.
              </p>
              <p className="mt-2 text-xs text-secondary-500">
                Browser credentials are not accepted or stored. Updated {formatTime(snapshot.generatedAt)}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Refreshing…' : 'Refresh evidence'}
            </button>
          </div>
          {snapshot.error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {snapshot.error}
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Activation</p>
            <p className="mt-2 text-xl font-bold text-secondary-900">
              {snapshot.activation?.activationBlocked === true ? 'Blocked' : 'Unavailable'}
            </p>
            <p className="mt-1 text-xs text-secondary-500">Live readiness is never inferred by this page.</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Deployment review</p>
            <p className="mt-2 text-xl font-bold text-secondary-900">
              {snapshot.deployment?.status.replaceAll('_', ' ') ?? 'Unavailable'}
            </p>
            <p className="mt-1 text-xs text-secondary-500">Review-ready does not authorize deployment.</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Permanent locks</p>
            <p className="mt-2 text-xl font-bold text-secondary-900">{allLocksHeld ? 'All held' : 'Rejected'}</p>
            <p className="mt-1 text-xs text-secondary-500">Unsafe gateway evidence fails closed.</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-secondary-900">Server-authorized scope</h2>
            {snapshot.operator ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Operator</p>
                  <p className="mt-1 break-all text-sm font-semibold text-secondary-900">{snapshot.operator.actorId}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Matched roles</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {snapshot.operator.matchedRoles.map((role) => (
                      <span key={role} className="rounded-full bg-secondary-100 px-2.5 py-1 text-xs font-semibold text-secondary-700">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Visible resources</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {snapshot.visibleResources.map((resource) => (
                      <span key={resource} className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
                        {resource.replaceAll('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-secondary-300 p-4 text-sm text-secondary-600">
                No trusted server-side operator identity is available. The browser cannot supply one.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-secondary-900">Capability locks</h2>
            <div className="mt-3 divide-y divide-secondary-100">
              <LockRow label="Deployment" locked={!snapshot.locks.deploymentAllowed} />
              <LockRow label="Demo provider request" locked={!snapshot.locks.demoRequestAllowed} />
              <LockRow label="Credential read" locked={!snapshot.locks.credentialsRead} />
              <LockRow label="Provider mutation" locked={!snapshot.locks.providerMutationAllowed} />
              <LockRow label="Live execution" locked={!snapshot.locks.liveExecutionAllowed} />
              <LockRow label="Real funds" locked={!snapshot.locks.realFundsAllowed} />
              <LockRow label="Mainnet" locked={!snapshot.locks.mainnetAllowed} />
              <LockRow label="Withdrawals" locked={!snapshot.locks.withdrawalsAllowed} />
              <LockRow label="Automatic retry" locked={!snapshot.locks.automaticRetryAllowed} />
              <LockRow label="Automatic accounting" locked={!snapshot.locks.accountingAutomaticallyDispatched} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-secondary-900">Deployment evidence</h2>
            {snapshot.deployment ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-secondary-50 p-3 text-center">
                    <p className="text-xs text-secondary-500">Total</p>
                    <p className="mt-1 text-lg font-bold text-secondary-900">{snapshot.deployment.checks.total}</p>
                  </div>
                  <div className="rounded-lg bg-secondary-50 p-3 text-center">
                    <p className="text-xs text-secondary-500">Passed</p>
                    <p className="mt-1 text-lg font-bold text-secondary-900">{snapshot.deployment.checks.passed}</p>
                  </div>
                  <div className="rounded-lg bg-secondary-50 p-3 text-center">
                    <p className="text-xs text-secondary-500">Blocked</p>
                    <p className="mt-1 text-lg font-bold text-secondary-900">{snapshot.deployment.checks.blocked}</p>
                  </div>
                </div>
                <dl className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-secondary-600">External read-only attestation</dt>
                    <dd><TextState value={snapshot.deployment.externalReadOnlyAttestationPresent ? 'Present' : 'Missing'} /></dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-secondary-600">Git SHA</dt>
                    <dd className="max-w-[60%] truncate"><TextState value={snapshot.deployment.gitSha} /></dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-secondary-600">Prepared</dt>
                    <dd><TextState value={formatTime(snapshot.deployment.preparedAt)} /></dd>
                  </div>
                </dl>
                {snapshot.deployment.blockers.length > 0 && (
                  <ul className="space-y-2">
                    {snapshot.deployment.blockers.map((blocker) => (
                      <li key={blocker} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {blocker}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-secondary-300 p-4 text-sm text-secondary-600">
                Deployment evidence is not visible to the current server-side role.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-secondary-900">Account evidence summary</h2>
            {snapshot.account ? (
              <dl className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Account</dt><dd><TextState value={snapshot.account.accountId} /></dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Product</dt><dd><TextState value={snapshot.account.productId} /></dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Certification</dt><dd><TextState value={snapshot.account.certificationStatus} /></dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Recovery readiness</dt><dd><TextState value={snapshot.account.recoveryReadinessStatus} /></dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Reconciliation</dt><dd><TextState value={snapshot.account.reconciliationStatus} /></dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Active alerts</dt><dd><TextState value={snapshot.account.activeAlertCount?.toString() ?? null} /></dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-sm text-secondary-600">Audit head</dt><dd><TextState value={formatTime(snapshot.account.auditHeadAt)} /></dd></div>
              </dl>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-secondary-300 p-4 text-sm text-secondary-600">
                No account-scoped evidence was provided by the trusted gateway.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
