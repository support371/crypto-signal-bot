import { Link } from "react-router-dom";

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="cyber-card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg">{icon}</span>
        <h3 className="font-display text-sm font-semibold tracking-wide text-foreground">{title}</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

export default function PublicHome() {
  return (
    <div className="min-h-screen bg-background scanlines">
      <header className="border-b border-border/40 bg-muted/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="font-display text-sm font-semibold tracking-[0.18em] text-primary">
            CRYPTO SIGNAL BOT
          </span>
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="font-mono text-xs text-muted-foreground hover:text-foreground transition"
            >
              Sign in
            </Link>
            <Link
              to="/dashboard"
              className="rounded border border-primary/60 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/20 transition"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 md:py-24">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-primary/70">
            Paper Trading Platform
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-wide text-foreground md:text-4xl lg:text-5xl">
            Deterministic, risk-first<br className="hidden sm:block" /> crypto signal analysis
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            Multi-strategy signal engine with real-time market data, Guardian risk authority,
            structured decision traces, and full paper-trading execution. Every decision is
            auditable. Every threshold is configurable. No live funds at risk.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/demo"
              className="rounded bg-primary px-5 py-2.5 font-mono text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
            >
              Try certification demo
            </Link>
            <Link
              to="/dashboard"
              className="rounded border border-border px-5 py-2.5 font-mono text-sm text-foreground hover:bg-muted/30 transition"
            >
              Open dashboard
            </Link>
          </div>
        </section>

        <section className="pb-16">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-primary/70">Platform capabilities</p>
              <h2 className="font-display text-lg font-semibold tracking-wide text-foreground">What the system provides</h2>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon="[S]"
              title="Multi-Strategy Signal Engine"
              description="Feature extraction, technical indicators, and signal classification across multiple strategies with confidence scoring and regime detection."
            />
            <FeatureCard
              icon="[G]"
              title="Guardian Risk Authority"
              description="Independent kill switch, drawdown limits, API error tracking, and failed order monitoring. Risk always overrides strategy."
            />
            <FeatureCard
              icon="[T]"
              title="Decision Trace Logging"
              description="Every execution intent records its full decision path: signal state, risk gate result, fill details, and timestamps for complete auditability."
            />
            <FeatureCard
              icon="[P]"
              title="Paper Trading Engine"
              description="FIFO lot accounting, realized P&L tracking, position management with the same execution path as live mode. No funds at risk."
            />
            <FeatureCard
              icon="[M]"
              title="Live Market Data"
              description="Real-time prices from CoinGecko and exchange APIs with WebSocket streaming, deterministic simulation fallback, and staleness detection."
            />
            <FeatureCard
              icon="[R]"
              title="Reconciliation & Health"
              description="Continuous drift detection between expected and observed state. Venue health monitoring and automatic failover across exchange adapters."
            />
          </div>
        </section>

        <section className="pb-16">
          <div className="cyber-card p-6 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent/70">Safe mode</p>
                <h2 className="mt-1 font-display text-lg font-semibold tracking-wide text-foreground">
                  Paper trading only
                </h2>
                <p className="mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground">
                  This platform operates exclusively in certification / paper-trading mode.
                  Live execution, real-money transactions, and withdrawal logic are architecturally
                  excluded. The system builds clean adapter interfaces so live venues can be added
                  later without changing core logic.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  Simulation safe
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  No live funds
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  Testnet only
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="pb-16">
          <nav className="grid gap-4 sm:grid-cols-2">
            <Link className="cyber-card p-5 hover:border-primary/40 transition group" to="/integrations">
              <h3 className="font-display text-sm font-semibold tracking-wide text-foreground group-hover:text-primary transition">
                Integration Status
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                View current provider readiness, exchange adapter health, and API connectivity.
              </p>
            </Link>
            <Link className="cyber-card p-5 hover:border-primary/40 transition group" to="/waitlist">
              <h3 className="font-display text-sm font-semibold tracking-wide text-foreground group-hover:text-primary transition">
                Join the Waitlist
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Register for product updates and early access to new trading strategies.
              </p>
            </Link>
          </nav>
        </section>
      </main>

      <footer className="border-t border-border bg-muted/20 py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 md:flex-row md:justify-between">
          <span className="font-mono text-xs text-muted-foreground">
            CRYPTO SIGNAL BOT v2.4 // PAPER MODE
          </span>
          <div className="flex gap-4 font-mono text-xs text-muted-foreground">
            <Link to="/status" className="hover:text-foreground transition">Status</Link>
            <Link to="/privacy" className="hover:text-foreground transition">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
