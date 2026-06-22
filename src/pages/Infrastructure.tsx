import { useCallback, useEffect, useState } from 'react';
import {
  CapabilityStatus,
  InfrastructureSnapshot,
  readInfrastructureSnapshot,
} from '../lib/infrastructureApi';

const statusClasses: Record<CapabilityStatus, string> = {
  healthy: 'bg-emerald-100 text-emerald-800',
  degraded: 'bg-amber-100 text-amber-800',
  halted: 'bg-red-100 text-red-800',
  unavailable: 'bg-red-100 text-red-800',
  not_reported: 'bg-secondary-100 text-secondary-700',
};

function StatusBadge({ status, label }: { status: CapabilityStatus; label?: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[status]}`}>
      {label ?? status.replace('_', ' ')}
    </span>
  );
}

function BooleanState({ value, safeWhenFalse = false }: { value: boolean; safeWhenFalse?: boolean }) {
  const safe = safeWhenFalse ? !value : value;
  return <StatusBadge status={safe ? 'healthy' : 'halted'} label={value ? 'enabled' : 'disabled'} />;
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-secondary-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-secondary-900">{value}</p>
      <p className="mt-1 text-xs text-secondary-500">{note}</p>
    </div>
  );
}

function formatMetric(value: number | null, suffix = ''): string {
  return value === null ? 'Not reported' : `${value.toLocaleString()}${suffix}`;
}

export default function Infrastructure() {
  const [snapshot, setSnapshot] = useState<InfrastructureSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await readInfrastructureSnapshot();
    setSnapshot(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  if (!snapshot && loading) {
    return (
      <div className="rounded-xl border border-secondary-200 bg-white p-8 text-center text-secondary-600">
        Loading infrastructure status…
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-secondary-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-secondary-900">Infrastructure Readiness</h1>
              <StatusBadge
                status={snapshot.paperSafetyOk ? 'healthy' : 'halted'}
                label={snapshot.paperSafetyOk ? 'paper safety verified' : 'paper safety unverified'}
              />
            </div>
            <p className="mt-2 max-w-3xl text-sm text-secondary-600">
              Read-only view of runtime safety, feed integrity, state authority, latency reporting, and migration gaps.
              Missing backend capabilities remain visibly unreported.
            </p>
            <p className="mt-2 text-xs text-secondary-500">
              Contract: {snapshot.sourceContract} · Updated {new Date(snapshot.generatedAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {snapshot.error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {snapshot.error}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="State authority"
          value={snapshot.fastPath.authority.replaceAll('_', ' ')}
          note="Target: per-portfolio Durable Object"
        />
        <MetricCard
          label="Decision latency"
          value={formatMetric(snapshot.fastPath.decisionLatencyMs, ' ms')}
          note="Internal event-to-commit measurement"
        />
        <MetricCard
          label="Decision data age"
          value={formatMetric(snapshot.fastPath.decisionDataAgeMs, ' ms')}
          note="Exchange timestamp to decision time"
        />
        <MetricCard
          label="Projection lag"
          value={formatMetric(snapshot.fastPath.projectionLagMs, ' ms')}
          note={`Queue status: ${snapshot.fastPath.queueStatus.replace('_', ' ')}`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-secondary-900">Runtime safety</h2>
          <div className="mt-4 divide-y divide-secondary-100">
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-secondary-600">Trading mode</span>
              <StatusBadge status={snapshot.runtime.tradingMode === 'paper' ? 'healthy' : 'halted'} label={snapshot.runtime.tradingMode} />
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-secondary-600">Exchange mode</span>
              <StatusBadge status={snapshot.runtime.exchangeMode === 'paper' ? 'healthy' : 'halted'} label={snapshot.runtime.exchangeMode} />
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-secondary-600">Network</span>
              <StatusBadge status={snapshot.runtime.network === 'testnet' ? 'healthy' : 'halted'} label={snapshot.runtime.network} />
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-secondary-600">Mainnet</span>
              <BooleanState value={snapshot.runtime.allowMainnet} safeWhenFalse />
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-secondary-600">Live execution</span>
              <BooleanState value={snapshot.runtime.liveTradingEnabled} safeWhenFalse />
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-secondary-600">Withdrawals</span>
              <BooleanState value={snapshot.runtime.withdrawalsEnabled} safeWhenFalse />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-secondary-900">Guardian</h2>
            <StatusBadge status={snapshot.guardian.status} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-secondary-50 p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">Halted</dt>
              <dd className="mt-1 text-lg font-semibold text-secondary-900">{snapshot.guardian.halted ? 'Yes' : 'No'}</dd>
            </div>
            <div className="rounded-lg bg-secondary-50 p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">Drawdown</dt>
              <dd className="mt-1 text-lg font-semibold text-secondary-900">{formatMetric(snapshot.guardian.drawdownPct, '%')}</dd>
            </div>
            <div className="col-span-2 rounded-lg bg-secondary-50 p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">Reason</dt>
              <dd className="mt-1 text-sm text-secondary-800">{snapshot.guardian.reason ?? 'No halt reason reported'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Market feed integrity</h2>
            <p className="text-sm text-secondary-500">Sequence, heartbeat, freshness, and recovery status must come from the backend.</p>
          </div>
          <StatusBadge status={snapshot.backendReachable ? 'healthy' : 'unavailable'} label={snapshot.backendReachable ? 'backend reachable' : 'backend unavailable'} />
        </div>
        {snapshot.feeds.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-secondary-300 p-5 text-sm text-secondary-600">
            No WebSocket feed-health records are reported yet.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-secondary-200 text-left text-sm">
              <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Channel</th>
                  <th className="px-3 py-3">Symbol</th>
                  <th className="px-3 py-3">Integrity</th>
                  <th className="px-3 py-3">Freshness</th>
                  <th className="px-3 py-3">Age</th>
                  <th className="px-3 py-3">Sequence</th>
                  <th className="px-3 py-3">Heartbeat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {snapshot.feeds.map((feed) => (
                  <tr key={`${feed.source}:${feed.channel}:${feed.symbol}`}>
                    <td className="px-3 py-3 font-medium text-secondary-900">{feed.source}</td>
                    <td className="px-3 py-3 text-secondary-600">{feed.channel}</td>
                    <td className="px-3 py-3 text-secondary-600">{feed.symbol}</td>
                    <td className="px-3 py-3"><StatusBadge status={feed.integrity} /></td>
                    <td className="px-3 py-3 text-secondary-600">{feed.freshness}</td>
                    <td className="px-3 py-3 text-secondary-600">{formatMetric(feed.eventAgeMs, ' ms')}</td>
                    <td className="px-3 py-3 text-secondary-600">{feed.sequenceState}</td>
                    <td className="px-3 py-3 text-secondary-600">{feed.heartbeatState}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Migration gaps</h2>
            <p className="text-sm text-secondary-500">These remain open until the backend reports measured capability.</p>
          </div>
          <span className="rounded-full bg-secondary-100 px-3 py-1 text-sm font-semibold text-secondary-700">
            {snapshot.gaps.length}
          </span>
        </div>
        {snapshot.gaps.length === 0 ? (
          <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">No infrastructure reporting gaps detected.</p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {snapshot.gaps.map((gap) => (
              <li key={gap} className="rounded-lg border border-secondary-200 bg-secondary-50 p-3 text-sm text-secondary-700">
                {gap}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
