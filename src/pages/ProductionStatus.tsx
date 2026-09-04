import { useCallback, useEffect, useMemo, useState } from 'react';

const REFRESH_MS = 15_000;

type ReleaseManifest = {
  application?: string;
  release_contract?: string;
  canonical_frontend_url?: string;
  dashboard_path?: string;
  status_path?: string;
  attestation_path?: string;
  backend_url?: string;
  execution_exchange_primary?: string;
  execution_exchange_secondary?: string;
  execution_exchanges?: string[];
  market_data_public_exchange?: string;
  trading_mode?: string;
  network?: string;
  live_trading_enabled?: boolean;
  withdrawals_enabled?: boolean;
  real_funds_enabled?: boolean;
};

type AttestationInvariant = {
  id: string;
  passed: boolean;
  detail: string;
};

type ProbeSummary = {
  path: string;
  status: number | null;
  latency_ms: number;
  content_type: string | null;
  json: boolean;
};

type ReleaseAttestation = {
  ok: boolean;
  attestation_version?: string;
  generated_at?: string;
  worker?: string;
  execution?: {
    primary?: string;
    secondary?: string;
  };
  safety?: {
    trading_mode?: string | null;
    network?: string | null;
    allow_mainnet?: boolean | null;
    live_trading_enabled?: boolean | null;
    withdrawals_enabled?: boolean | null;
    provider_mutation_enabled?: boolean | null;
    real_funds_enabled?: boolean | null;
  };
  storage?: {
    d1_status?: string | null;
    agent_memory_available?: boolean | null;
  };
  invariants?: AttestationInvariant[];
  failures?: AttestationInvariant[];
  probes?: ProbeSummary[];
};

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${path} returned ${contentType || 'non-JSON content'}`);
  }
  const body = await response.json() as T;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'failures' in body
      ? JSON.stringify((body as ReleaseAttestation).failures ?? [])
      : `HTTP ${response.status}`;
    throw new Error(`${path} returned HTTP ${response.status}: ${detail}`);
  }
  return body;
}

function Badge({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
      {children}
    </span>
  );
}

function SafetyRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-secondary-100 py-3 last:border-b-0">
      <span className="text-sm text-secondary-600">{label}</span>
      <div className="flex items-center gap-2 text-right">
        <span className="font-mono text-xs text-secondary-700">{value}</span>
        <Badge ok={ok}>{ok ? 'verified' : 'blocked'}</Badge>
      </div>
    </div>
  );
}

export default function ProductionStatus() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null);
  const [attestation, setAttestation] = useState<ReleaseAttestation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    try {
      const manifest = await fetchJson<ReleaseManifest>('/release.json', controller.signal);
      const attestationPath = manifest.attestation_path ?? '/api/release-attestation';
      const nextAttestation = await fetchJson<ReleaseAttestation>(attestationPath, controller.signal);
      setRelease(manifest);
      setAttestation(nextAttestation);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const invariantTotals = useMemo(() => {
    const invariants = attestation?.invariants ?? [];
    return {
      total: invariants.length,
      passed: invariants.filter((item) => item.passed).length,
    };
  }, [attestation]);

  const overallOk = Boolean(attestation?.ok && !error);
  const probes = attestation?.probes ?? [];
  const invariants = attestation?.invariants ?? [];

  return (
    <main className="min-h-screen bg-secondary-50 px-4 py-8 text-secondary-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-secondary-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">Crypto Signal Bot Production Status</h1>
                <Badge ok={overallOk}>{overallOk ? 'release attested' : 'release degraded'}</Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-secondary-600">
                Read-only end-to-end verification of the Vercel frontend, migrated Cloudflare Worker, execution-exchange hierarchy, storage bindings, Guardian state, and certification safety locks.
              </p>
              <p className="mt-2 text-xs text-secondary-500">
                Auto-refreshes every 15 seconds · Attestation {attestation?.attestation_version ?? 'not loaded'} · {attestation?.generated_at ? new Date(attestation.generated_at).toLocaleString() : 'waiting for evidence'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Frontend</p>
            <p className="mt-2 break-all text-sm font-semibold">{release?.canonical_frontend_url ?? window.location.origin}</p>
            <p className="mt-2 text-xs text-secondary-500">Vercel production provider</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Backend</p>
            <p className="mt-2 break-all text-sm font-semibold">{attestation?.worker ?? release?.backend_url ?? 'Unavailable'}</p>
            <p className="mt-2 text-xs text-secondary-500">Cloudflare Worker</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Execution hierarchy</p>
            <p className="mt-2 text-xl font-bold uppercase">{attestation?.execution?.primary ?? release?.execution_exchange_primary ?? '—'} → {attestation?.execution?.secondary ?? release?.execution_exchange_secondary ?? '—'}</p>
            <p className="mt-2 text-xs text-secondary-500">BTCC primary · Bitget secondary</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Invariant score</p>
            <p className="mt-2 text-2xl font-bold">{invariantTotals.passed}/{invariantTotals.total || '—'}</p>
            <p className="mt-2 text-xs text-secondary-500">Fail-closed production contract</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Safety locks</h2>
            <div className="mt-3">
              <SafetyRow label="Trading mode" value={attestation?.safety?.trading_mode ?? 'unknown'} ok={attestation?.safety?.trading_mode === 'paper'} />
              <SafetyRow label="Network" value={attestation?.safety?.network ?? 'unknown'} ok={attestation?.safety?.network === 'testnet'} />
              <SafetyRow label="Mainnet" value={String(attestation?.safety?.allow_mainnet ?? 'unknown')} ok={attestation?.safety?.allow_mainnet === false} />
              <SafetyRow label="Live trading" value={String(attestation?.safety?.live_trading_enabled ?? 'unknown')} ok={attestation?.safety?.live_trading_enabled === false} />
              <SafetyRow label="Withdrawals" value={String(attestation?.safety?.withdrawals_enabled ?? 'unknown')} ok={attestation?.safety?.withdrawals_enabled === false} />
              <SafetyRow label="Provider mutation" value={String(attestation?.safety?.provider_mutation_enabled ?? 'unknown')} ok={attestation?.safety?.provider_mutation_enabled === false} />
              <SafetyRow label="Real funds" value={String(attestation?.safety?.real_funds_enabled ?? 'unknown')} ok={attestation?.safety?.real_funds_enabled === false} />
            </div>
          </div>

          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Runtime dependencies</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-secondary-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">D1</p>
                <p className="mt-1 text-lg font-semibold">{attestation?.storage?.d1_status ?? 'unknown'}</p>
              </div>
              <div className="rounded-lg bg-secondary-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Agent memory</p>
                <p className="mt-1 text-lg font-semibold">{attestation?.storage?.agent_memory_available === true ? 'available' : 'unavailable'}</p>
              </div>
              <div className="rounded-lg bg-secondary-50 p-4 sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Public market-data source</p>
                <p className="mt-1 text-lg font-semibold uppercase">{release?.market_data_public_exchange ?? 'not reported'}</p>
                <p className="mt-1 text-xs text-secondary-500">Market data only; not the primary or secondary execution exchange.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Worker probes</h2>
              <p className="text-sm text-secondary-500">Each production dependency must return HTTP 200 JSON.</p>
            </div>
            <Badge ok={probes.length > 0 && probes.every((probe) => probe.status === 200 && probe.json)}>
              {probes.length > 0 && probes.every((probe) => probe.status === 200 && probe.json) ? 'all reachable' : 'probe failure'}
            </Badge>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-secondary-200 text-left text-sm">
              <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-3">Endpoint</th>
                  <th className="px-3 py-3">HTTP</th>
                  <th className="px-3 py-3">JSON</th>
                  <th className="px-3 py-3">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {probes.map((probe) => (
                  <tr key={probe.path}>
                    <td className="px-3 py-3 font-mono text-xs">{probe.path}</td>
                    <td className="px-3 py-3">{probe.status ?? 'unreachable'}</td>
                    <td className="px-3 py-3">{probe.json ? 'yes' : 'no'}</td>
                    <td className="px-3 py-3">{probe.latency_ms.toLocaleString()} ms</td>
                  </tr>
                ))}
                {probes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-secondary-500">No probe evidence loaded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Production invariants</h2>
              <p className="text-sm text-secondary-500">Any failed invariant degrades the attestation rather than silently continuing.</p>
            </div>
            <span className="rounded-full bg-secondary-100 px-3 py-1 text-sm font-semibold text-secondary-700">{invariants.length}</span>
          </div>
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {invariants.map((item) => (
              <li key={item.id} className={`rounded-lg border p-3 ${item.passed ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-secondary-900">{item.id}</p>
                    <p className="mt-1 text-xs text-secondary-600">{item.detail}</p>
                  </div>
                  <Badge ok={item.passed}>{item.passed ? 'pass' : 'fail'}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
