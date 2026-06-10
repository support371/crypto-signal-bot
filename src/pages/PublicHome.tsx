import { Link } from "react-router-dom";
import { TrendingUp, Activity, ShieldCheck, Zap } from "lucide-react";

export default function PublicHome() {
  return (
    <main className="min-h-screen bg-background font-mono">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp className="h-10 w-10 text-accent" />
          <h1 className="text-4xl font-bold tracking-tight">CRYPTO RISK AGENT</h1>
        </div>
        <p className="text-muted-foreground max-w-lg mb-10 text-sm leading-relaxed">
          Autonomous paper-trading signal bot with real-time risk management, 
          guardian kill-switch, and multi-exchange market data.
          <span className="block mt-2 text-amber-500 font-semibold">
            Paper trading only — no real money involved.
          </span>
        </p>
        <div className="flex items-center gap-4">
          <Link
            to="/auth"
            className="px-6 py-2.5 rounded-lg bg-accent text-accent-foreground font-semibold text-sm hover:bg-accent/90 transition-colors"
          >
            Sign In
          </Link>
          <Link
            to="/waitlist"
            className="px-6 py-2.5 rounded-lg border border-border text-foreground text-sm hover:bg-muted transition-colors"
          >
            Join Waitlist
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="mx-auto max-w-4xl px-6 py-16 grid sm:grid-cols-2 gap-6">
        {[
          {
            icon: Activity,
            title: "Live Market Data",
            desc: "Real-time price feeds from CoinGecko, Binance, and Bitget with automatic fallback.",
          },
          {
            icon: ShieldCheck,
            title: "Guardian Risk Engine",
            desc: "Autonomous kill-switch that halts trading on drawdown, API errors, or failed orders.",
          },
          {
            icon: Zap,
            title: "Signal Analysis",
            desc: "RSI, MACD, Bollinger Bands and ML-assisted direction signals with confidence scoring.",
          },
          {
            icon: TrendingUp,
            title: "Paper Portfolio",
            desc: "Full P&L tracking with audit trail, backtest engine, and earnings history.",
          },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-3">
              <Icon className="h-5 w-5 text-accent" />
              <h2 className="font-semibold text-sm">{title}</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Footer links */}
      <div className="border-t border-border px-6 py-8">
        <div className="mx-auto max-w-4xl flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>Crypto Risk Agent — Paper trading only</span>
          <nav className="flex items-center gap-6">
            <Link to="/integrations" className="hover:text-foreground transition-colors">Integration Status</Link>
            <Link to="/health"       className="hover:text-foreground transition-colors">System Health</Link>
            <Link to="/auth"         className="hover:text-foreground transition-colors">Sign In</Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
