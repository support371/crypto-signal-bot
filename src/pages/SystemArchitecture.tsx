const layers = [
  {
    title: 'Market Data Gateway',
    status: 'TARGET',
    description: 'Streaming-first ingestion with source, timestamp, sequence, heartbeat, age, and execution eligibility.',
  },
  {
    title: 'Scout Agents',
    status: 'TARGET',
    description: 'Independent momentum, trend, volume, volatility, liquidity, reversal, and market-quality observers.',
  },
  {
    title: 'Signal Fusion',
    status: 'TARGET',
    description: 'Combines scout evidence, applies conflict penalties, confidence decay, and expiry before risk review.',
  },
  {
    title: 'Risk Engine',
    status: 'CORE AUTHORITY',
    description: 'The only component allowed to approve capital, size exposure, and reject unsafe opportunities.',
  },
  {
    title: 'Execution Engine',
    status: 'PAPER ONLY',
    description: 'Validates freshness, guardian state, balance, idempotency, and applies atomic simulated fills.',
  },
  {
    title: 'Position Guardian',
    status: 'TARGET',
    description: 'Manages partial profit-taking, trailing protection, deterioration exits, and cooldown decisions.',
  },
  {
    title: 'Portfolio Ledger',
    status: 'TARGET STANDARD',
    description: 'Tracks cash, reserves, cost basis, realized and unrealized PnL, equity, peak equity, and drawdown.',
  },
  {
    title: 'Protected Profit Reserve',
    status: 'INTERNAL ONLY',
    description: 'Locks a configured share of positive realized profit inside the dashboard; no external withdrawal.',
  },
];

const capitalStates = [
  'Available trading cash',
  'Reserved for pending orders',
  'Protected profit reserve',
  'Invested cost basis',
  'Open position market value',
  'Realized PnL',
  'Unrealized PnL',
  'Total equity',
];

const controls = [
  'Paper trading enforced',
  'Mainnet disabled',
  'External withdrawals blocked',
  'Risk engine is sole capital authority',
  'Stale/static prices cannot fill',
  'Every financial mutation is idempotent and auditable',
];

const phases = [
  'Normalize market-data quality and freshness',
  'Add typed scout events and expiry',
  'Build signal fusion and conflict handling',
  'Centralize deterministic risk approval',
  'Add atomic idempotent paper execution',
  'Add position guardian and state machine',
  'Add protected-profit reserve accounting',
  'Add replay, shadow mode, parity, and latency metrics',
];

export default function SystemArchitecture() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-slate-950 p-6 text-white shadow-lg md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Target Operating Standard
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Trading System Architecture</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
              A fast, evidence-driven paper-trading architecture that separates observation, signal interpretation,
              capital approval, execution, position protection, accounting, and internal profit preservation.
            </p>
          </div>
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            Profitability must be measured in paper validation. It is not guaranteed.
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {controls.map((control) => (
          <div key={control} className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-950">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
            {control}
          </div>
        ))}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-950">Decision and execution flow</h2>
          <p className="mt-1 text-sm text-slate-600">Each layer has one responsibility and cannot bypass the next control boundary.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {layers.map((layer, index) => (
            <article key={layer.title} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{index + 1}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700">{layer.status}</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-950">{layer.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{layer.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Fast path</h2>
          <p className="mt-2 text-sm text-slate-600">Low-latency market response without removing risk controls.</p>
          <div className="mt-5 space-y-3">
            {['Stream event', 'Integrity gate', 'Incremental features', 'Scout consensus', 'Risk decision', 'Idempotent paper order', 'Guardian supervision'].map((item, index) => (
              <div key={item} className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{index + 1}</span>
                <span className="text-sm font-medium text-slate-800">{item}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Capital model</h2>
          <p className="mt-2 text-sm text-slate-600">Dashboard funds are separated so realized gains can be protected internally.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {capitalStates.map((state) => (
              <div key={state} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">{state}</div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">Profit realization flow</h2>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
          {['Profitable paper position', 'Partial or full sell', 'Release original capital', 'Calculate realized PnL', 'Credit dashboard cash', 'Move configured share to protected reserve'].map((step, index, items) => (
            <div key={step} className="flex items-center gap-2">
              <span className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950 ring-1 ring-amber-200">{step}</span>
              {index < items.length - 1 && <span className="text-slate-400">→</span>}
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-600">This is internal accounting and position management, not a transfer to an external wallet.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">Implementation roadmap</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {phases.map((phase, index) => (
            <div key={phase} className="flex gap-3 rounded-xl bg-slate-50 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span>
              <span className="text-sm font-medium text-slate-800">{phase}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
