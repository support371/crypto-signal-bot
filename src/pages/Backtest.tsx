// src/pages/Backtest.tsx
import { BacktestPanel } from "@/components/dashboard/BacktestPanel";
import { NavLink } from "@/components/NavLink";
import { BarChart2, LayoutDashboard } from "lucide-react";

export default function BacktestPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Nav */}
      <header className="border-b border-slate-800 px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2 font-semibold text-white">
          <BarChart2 size={18} className="text-blue-400" />
          Signal Quality Audit
        </div>
        <nav className="flex items-center gap-3 ml-auto text-sm">
          <NavLink to="/" className="flex items-center gap-1 text-slate-400 hover:text-white">
            <LayoutDashboard size={14} />Dashboard
          </NavLink>
        </nav>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-2">
        <div>
          <h1 className="text-xl font-bold">Strategy Backtest</h1>
          <p className="text-slate-400 text-sm mt-1">
            Walk-forward simulation on live market data. Compares all three signal strategies head-to-head.
          </p>
        </div>
        <BacktestPanel />
      </main>
    </div>
  );
}
