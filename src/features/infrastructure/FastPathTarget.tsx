import type { CapabilityStatus, StateAuthority } from '../../lib/infrastructureApi';

interface FastPathTargetProps {
  authority: StateAuthority;
  queueStatus: CapabilityStatus;
  feedCount: number;
  paperSafetyOk: boolean;
}

const stages = [
  {
    title: 'Market Integrity',
    owner: 'Feed gateway',
    description: 'WebSocket events, sequence continuity, heartbeat, source age, recovery and secondary confirmation.',
  },
  {
    title: 'Scout Layer',
    owner: 'Observation only',
    description: 'Momentum, book imbalance, liquidity, reversal, volatility and feed-disagreement scouts produce evidence — never orders.',
  },
  {
    title: 'Signal Fusion',
    owner: 'Deterministic ranking',
    description: 'Combines independent evidence, applies confidence decay, and emits a replayable candidate with reason codes.',
  },
  {
    title: 'Risk Authority',
    owner: 'Sole capital authority',
    description: 'Approves or rejects size from reusable cash, exposure, drawdown, guardian, liquidity, volatility and cooldown state.',
  },
  {
    title: 'Portfolio Authority',
    owner: 'Per-portfolio state owner',
    description: 'Commits one idempotent paper fill and atomically updates cash, position, PnL, equity, drawdown and exit state.',
  },
  {
    title: 'Position Guardian',
    owner: 'Profit/risk protection',
    description: 'Runs staged reductions, trailing protection, deterioration exits, full close, de-risking and cooldown.',
  },
  {
    title: 'Profit Reserve',
    owner: 'Internal capital protection',
    description: 'Returns realized proceeds to the dashboard and can sweep a configured share of positive realized PnL into a protected internal reserve.',
  },
  {
    title: 'Projection & Replay',
    owner: 'Async slow path',
    description: 'Queues fan out audit/analytics events; D1 serves read models and R2 stores replay data outside the critical path.',
  },
] as const;

function compactStatus(value: string) {
  return value.replaceAll('_', ' ');
}

export default function FastPathTarget({ authority, queueStatus, feedCount, paperSafetyOk }: FastPathTargetProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 via-white to-secondary-50 shadow-sm">
      <div className="border-b border-primary-100 px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary-700">Authoritative target</p>
            <h2 className="mt-1 text-xl font-bold text-secondary-950">Safe Fast Path Architecture</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-secondary-600">
              Preserve the project pattern: scouts observe, fusion ranks, the risk engine alone allocates capital, one portfolio authority commits paper state, and the position guardian realizes and protects gains. External withdrawals remain separate from internal profit realization.
            </p>
          </div>
          <div className="grid min-w-[260px] grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-secondary-200 bg-white p-3">
              <p className="text-secondary-500">Current authority</p>
              <p className="mt-1 font-semibold capitalize text-secondary-900">{compactStatus(authority)}</p>
            </div>
            <div className="rounded-lg border border-secondary-200 bg-white p-3">
              <p className="text-secondary-500">Target authority</p>
              <p className="mt-1 font-semibold text-secondary-900">portfolio durable object</p>
            </div>
            <div className="rounded-lg border border-secondary-200 bg-white p-3">
              <p className="text-secondary-500">Feed records</p>
              <p className="mt-1 font-semibold text-secondary-900">{feedCount}</p>
            </div>
            <div className="rounded-lg border border-secondary-200 bg-white p-3">
              <p className="text-secondary-500">Async queue</p>
              <p className="mt-1 font-semibold capitalize text-secondary-900">{compactStatus(queueStatus)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-6 md:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => (
          <div key={stage.title} className="relative rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Stage {index + 1}</p>
                <h3 className="mt-1 font-semibold text-secondary-950">{stage.title}</h3>
              </div>
              <span className="rounded-full bg-secondary-100 px-2 py-1 text-[10px] font-semibold text-secondary-700">
                {stage.owner}
              </span>
            </div>
            <p className="mt-3 text-sm leading-5 text-secondary-600">{stage.description}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-t border-primary-100 bg-white/70 px-6 py-5 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Safety boundary</p>
          <p className="mt-2 text-sm font-semibold text-emerald-950">
            {paperSafetyOk ? 'Certification safety currently verified' : 'Certification safety must be verified before any sensitive action'}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Execution quality</p>
          <p className="mt-2 text-sm text-amber-950">Fast means fresh-data, low-latency, idempotent decisions — not uncontrolled trade frequency.</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-sky-800">Profit protection</p>
          <p className="mt-2 text-sm text-sky-950">Position exits realize PnL internally; reserve sweeps protect part of positive realized PnL from ordinary reuse.</p>
        </div>
      </div>
    </section>
  );
}
