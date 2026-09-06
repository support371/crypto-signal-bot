import { useCallback, useEffect, useMemo, useState } from 'react';

const REFRESH_MS = 15_000;

type ReleaseManifest = {
  application?: string;
  release_contract?: string;
  canonical_frontend_url?: string;
  dashboard_path?: string;
  account_path?: string;
  admin_path?: string;
  status_path?: string;
  attestation_path?: string;
  management_api_path?: string;
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
  provider_mutation_enabled?: boolean;
  canonical_demo_identity_enabled?: boolean;
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
  execution?: { primary?: string; secondary?: string };
  safety?: {
    trading_mode?: string | null;
    network?: string | null;
    allow_mainnet?: boolean | null;
    live_trading_enabled?: boolean | null;
    withdrawals_enabled?: boolean | null;
    provider_mutation_enabled?: boolean | null;
    real_funds_enabled?: boolean | null;
  };
  storage?: { d1_status?: string | null; agent_memory_available?: boolean | null };
  invariants?: AttestationInvariant[];
  failures?: AttestationInvariant[];
  probes?: ProbeSummary[];
};

type ManagementReadiness = {
  ok: boolean;
  generated_at?: string;
  worker?: string;
  management?: {
    route_present?: boolean;
    identity_provider_configured?: boolean;
    authentication_enforced?: boolean;
    status?: number | null;
    code?: string | null;
    latency_ms?: number;
  };
};

type VerificationState = 'verified' | 'blocked' | 'pending';

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
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return body;
}

function Badge({ state, children }: { state: VerificationState; children: string }) {
  const classes = state === 'verified'
    ? 'border-accent/30 bg-accent/10 text-accent'
    : state === 'blocked'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : 'border-warning/30 bg-warning/10 text-warning';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${classes}`}>
      {children}
    </span>
  );
}

function stateFor(value: boolean | undefined): VerificationState {
  if (value === true) return 'verified';
  if (value === false) return 'blocked';
  return 'pending';
}

function SafetyRow({ label, value, state }: { label: string; value: string; state: VerificationState }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 text-right">
        <span className="font-mono text-xs text-foreground/80">{value}</span>
        <Badge state={state}>{state}</Badge>
      </div>
    </div>
  );
}

function StatusTile({ label, value, detail, state = 'pending' }: { label: string; value: string; detail: string; state?: VerificationState }) {
  const tone = state === 'verified' ? 'text-accent' : state === 'blocked' ? 'text-destructive' : 'text-primary';
  return (
    <div className="cyber-card min-h-[122px] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
        <Badge state={state}>{state}</Badge>
      </div>
      <p className={`mt-3 break-words font-display text-sm font-semibold tracking-wide ${tone}`}>{value}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function ProductionStatus() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null);
  const [attestation, setAttestation] = useState<ReleaseAttestation | null>(null);
  const [management, setManagement] = useState<ManagementReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    try {
      const manifest = await fetchJson<ReleaseManifest>('/release.json', controller.signal);
      setRelease(manifest);
      const attestationPath = manifest.attestation_path ?? '/api/release-attestation';
      const [nextAttestation, nextManagement] = await Promise.all([
        fetchJson<ReleaseAttestation>(attestationPath, controller.signal),
        fetchJson<ManagementReadiness>('/api/management-readiness', controller.signal),
      ]);
      setAttestation(nextAttestation);
      setManagement(nextManagement);
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
    return { total: invariants.length, passed: invariants.filter((item) => item.passed).length };
  }, [attestation]);

  const attestationState: VerificationState = loading && !attestation
    ? 'pending'
    : attestation?.ok === true && !error
      ? 'verified'
      : 'blocked';
  const managementState: VerificationState = loading && !management
    ? 'pending'
    : management?.ok === true
      ? 'verified'
      : 'blocked';
  const overallState: VerificationState = attestationState === 'verified' && managementState === 'verified'
    ? 'verified'
    : attestationState === 'blocked' || managementState === 'blocked'
      ? 'blocked'
      : 'pending';

  const probes = attestation?.probes ?? [];
  const invariants = attestation?.invariants ?? [];
  const probesState: VerificationState = probes.length === 0
    ? 'pending'
    : probes.every((probe) => probe.status === 200 && probe.json)
      ? 'verified'
      : 'blocked';

  const safety = attestation?.safety;
  const frontendUrl = release?.canonical_frontend_url ?? window.location.origin;
  const backendUrl = attestation?.worker ?? release?.backend_url ?? 'Checking Worker…';
  const executionPrimary = attestation?.execution?.primary ?? release?.execution_exchange_primary;
  const executionSecondary = attestation?.execution?.secondary ?? release?.execution_exchange_secondary;

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="cyber-card overflow-hidden">
          <div className="border-b border-border/60 bg-card/80 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary/70">Production control plane</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-2xl font-semibold tracking-wide sm:text-3xl">Crypto Signal Bot Status</h1>
                  <Badge state={overallState}>
                    {overallState === 'verified' ? 'release attested' : overallState === 'blocked' ? 'attention required' : 'checking release'}
                  </Badge>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  Canonical production evidence for Vercel, the migrated Cloudflare Worker, authenticated management, storage, Guardian state, execution hierarchy and permanent paper/testnet locks.
                </p>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  Auto-refresh 15s · {attestation?.generated_at ? `attested ${new Date(attestation.generated_at).toLocaleString()}` : loading ? 'collecting runtime evidence…' : 'runtime evidence unavailable'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href="/dashboard" className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 font-mono text-xs text-primary transition hover:bg-primary/15">Open dashboard</a>
                <a href="/account" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground transition hover:bg-muted">Account</a>
                <a href="/auth" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground transition hover:bg-muted">Sign in</a>
                <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg bg-primary px-3 py-2 font-mono text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? 'Checking…' : 'Refresh'}
                </button>
              </div>
            </div>
          </div>
          {error && (
            <div className="border-t border-warning/20 bg-warning/10 px-5 py-3 font-mono text-xs text-warning sm:px-6">
              Latest refresh did not complete: {error}. Existing verified evidence is preserved while the next refresh retries.
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatusTile label="Frontend" value={frontendUrl.replace('https://', '')} detail="Canonical Vercel production alias" state={release ? 'verified' : 'pending'} />
          <StatusTile label="Backend" value={backendUrl.replace('https://', '')} detail="Migrated Cloudflare Worker" state={attestation?.worker ? 'verified' : attestationState} />
          <StatusTile label="Execution" value={executionPrimary && executionSecondary ? `${executionPrimary.toUpperCase()} → ${executionSecondary.toUpperCase()}` : 'Checking…'} detail="BTCC primary · Bitget secondary" state={executionPrimary === 'btcc' && executionSecondary === 'bitget' ? 'verified' : attestationState} />
          <StatusTile label="Management auth" value={management?.management?.authentication_enforced ? 'Bearer enforced' : 'Checking…'} detail={management?.management?.identity_provider_configured ? 'Supabase identity configured' : 'Identity readiness pending'} state={managementState} />
          <StatusTile label="Invariant score" value={invariantTotals.total ? `${invariantTotals.passed}/${invariantTotals.total}` : 'Checking…'} detail="Fail-closed production contract" state={invariantTotals.total ? (invariantTotals.passed === invariantTotals.total ? 'verified' : 'blocked') : 'pending'} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="cyber-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/70">Safety boundary</p>
                <h2 className="mt-1 font-display text-lg font-semibold">Permanent release locks</h2>
              </div>
              <Badge state={attestationState}>{attestationState}</Badge>
            </div>
            <div className="mt-3">
              <SafetyRow label="Trading mode" value={safety?.trading_mode ?? 'checking'} state={safety?.trading_mode === undefined ? 'pending' : safety.trading_mode === 'paper' ? 'verified' : 'blocked'} />
              <SafetyRow label="Network" value={safety?.network ?? 'checking'} state={safety?.network === undefined ? 'pending' : safety.network === 'testnet' ? 'verified' : 'blocked'} />
              <SafetyRow label="Mainnet" value={safety?.allow_mainnet === undefined ? 'checking' : String(safety.allow_mainnet)} state={safety?.allow_mainnet === undefined ? 'pending' : stateFor(safety.allow_mainnet === false)} />
              <SafetyRow label="Live trading" value={safety?.live_trading_enabled === undefined ? 'checking' : String(safety.live_trading_enabled)} state={safety?.live_trading_enabled === undefined ? 'pending' : stateFor(safety.live_trading_enabled === false)} />
              <SafetyRow label="Withdrawals" value={safety?.withdrawals_enabled === undefined ? 'checking' : String(safety.withdrawals_enabled)} state={safety?.withdrawals_enabled === undefined ? 'pending' : stateFor(safety.withdrawals_enabled === false)} />
              <SafetyRow label="Provider mutation" value={safety?.provider_mutation_enabled === undefined ? 'checking' : String(safety.provider_mutation_enabled)} state={safety?.provider_mutation_enabled === undefined ? 'pending' : stateFor(safety.provider_mutation_enabled === false)} />
              <SafetyRow label="Real funds" value={safety?.real_funds_enabled === undefined ? 'checking' : String(safety.real_funds_enabled)} state={safety?.real_funds_enabled === undefined ? 'pending' : stateFor(safety.real_funds_enabled === false)} />
            </div>
          </div>

          <div className="cyber-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/70">Runtime dependencies</p>
            <h2 className="mt-1 font-display text-lg font-semibold">Infrastructure readiness</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">D1 database</p>
                <p className={`mt-2 font-display text-lg ${attestation?.storage?.d1_status === 'healthy' ? 'text-accent' : 'text-warning'}`}>{attestation?.storage?.d1_status ?? 'checking'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Agent memory</p>
                <p className={`mt-2 font-display text-lg ${attestation?.storage?.agent_memory_available ? 'text-accent' : 'text-warning'}`}>{attestation?.storage?.agent_memory_available === undefined ? 'checking' : attestation.storage.agent_memory_available ? 'available' : 'unavailable'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 sm:col-span-2 lg:col-span-1 xl:col-span-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Management plane</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge state={managementState}>{managementState}</Badge>
                  <span className="font-mono text-xs text-foreground/80">anonymous probe HTTP {management?.management?.status ?? '…'} {management?.management?.code ?? ''}</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">A 401 UNAUTHENTICATED response is the expected healthy anonymous posture: the route exists, Supabase is configured, and bearer authentication is enforced.</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 sm:col-span-2 lg:col-span-1 xl:col-span-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Public market data</p>
                <p className="mt-2 font-display text-lg uppercase text-primary">{release?.market_data_public_exchange ?? 'checking'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Read-only data source; execution authority remains BTCC → Bitget.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="cyber-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/70">Worker evidence</p>
              <h2 className="mt-1 font-display text-lg font-semibold">Production endpoint probes</h2>
            </div>
            <Badge state={probesState}>{probesState === 'verified' ? 'all reachable' : probesState}</Badge>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-y border-border/60 bg-muted/30 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-3 py-3">Endpoint</th><th className="px-3 py-3">HTTP</th><th className="px-3 py-3">JSON</th><th className="px-3 py-3">Latency</th></tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {probes.map((probe) => (
                  <tr key={probe.path} className="font-mono text-xs">
                    <td className="px-3 py-3 text-primary">{probe.path}</td>
                    <td className="px-3 py-3">{probe.status ?? 'unreachable'}</td>
                    <td className="px-3 py-3">{probe.json ? 'yes' : 'no'}</td>
                    <td className="px-3 py-3">{probe.latency_ms.toLocaleString()} ms</td>
                  </tr>
                ))}
                {probes.length === 0 && <tr><td colSpan={4} className="px-3 py-7 text-center font-mono text-xs text-muted-foreground">{loading ? 'Collecting Worker evidence…' : 'No probe evidence loaded yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="cyber-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/70">Attestation</p>
              <h2 className="mt-1 font-display text-lg font-semibold">Production invariants</h2>
            </div>
            <span className="rounded-full border border-border bg-muted/30 px-3 py-1 font-mono text-xs text-muted-foreground">{invariants.length || 'checking'}</span>
          </div>
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {invariants.map((item) => (
              <li key={item.id} className={`rounded-lg border p-3 ${item.passed ? 'border-accent/20 bg-accent/5' : 'border-destructive/20 bg-destructive/5'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-mono text-xs font-semibold text-foreground">{item.id}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p></div>
                  <Badge state={item.passed ? 'verified' : 'blocked'}>{item.passed ? 'pass' : 'fail'}</Badge>
                </div>
              </li>
            ))}
            {invariants.length === 0 && <li className="rounded-lg border border-border/60 bg-muted/20 p-5 font-mono text-xs text-muted-foreground lg:col-span-2">{loading ? 'Collecting invariant evidence…' : 'Invariant evidence has not loaded. Use Refresh to retry.'}</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
