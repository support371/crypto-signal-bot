import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Loader2,
  LogOut,
  Settings,
  ShieldCheck,
  TestTube2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, isSupabaseConfigured as SUPABASE_CONFIGURED } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchBackendJson } from '@/lib/backend';
import { PAPER_DASHBOARD_ROUTES } from '@/lib/paperDashboardRoutes';

interface HeaderProps {
  onSettingsClick?: () => void;
  backendConnected?: boolean;
  killSwitchActive?: boolean;
  certificationBalance?: number | null;
  systemMode?: string;
}

type TestProbe = {
  label: string;
  ok: boolean;
};

type DashboardTestState = {
  running: boolean;
  ranAt: string | null;
  probes: TestProbe[];
};

type PaperPortfolioSummary = {
  balance_usdt?: number;
  cash_usdt?: number;
  equity_usdt?: number;
  mode?: string;
};

type PaperPriceSnapshot = {
  symbol?: string;
  price?: number;
};

type PaperTradeResponse = {
  id?: string;
  order_id?: string;
  status?: string;
  symbol?: string;
  side?: string;
  quantity?: number | string;
  price?: number | string;
  fill_price?: number | string | null;
  notional_usdt?: number | string;
  mode?: string;
};

type PaperTradeTestState = {
  running: boolean;
  ranAt: string | null;
  error: string | null;
  result: null | {
    orderId: string;
    symbol: string;
    side: string;
    quantity: number;
    fillPrice: number;
    notionalUsdt: number;
    cashBefore: number;
    cashAfter: number;
    equityAfter: number;
  };
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const quantityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
});

export function Header({
  onSettingsClick,
  backendConnected = false,
  killSwitchActive = false,
  certificationBalance,
  systemMode = 'paper',
}: HeaderProps) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [dashboardTest, setDashboardTest] = useState<DashboardTestState>({
    running: false,
    ranAt: null,
    probes: [],
  });
  const [paperTradeTest, setPaperTradeTest] = useState<PaperTradeTestState>({
    running: false,
    ranAt: null,
    error: null,
    result: null,
  });

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out successfully');
    navigate('/auth');
  };

  const runDashboardTest = async () => {
    if (dashboardTest.running) return;

    setDashboardTest({ running: true, ranAt: null, probes: [] });

    const targets = [
      ['Backend health', PAPER_DASHBOARD_ROUTES.health],
      ['Runtime status', PAPER_DASHBOARD_ROUTES.runtimeStatus],
      ['Exchange status', PAPER_DASHBOARD_ROUTES.exchangeStatus],
      ['Portfolio summary', PAPER_DASHBOARD_ROUTES.portfolioSummary],
      ['Signal engine', PAPER_DASHBOARD_ROUTES.signalLatest],
    ] as const;

    const remoteProbes = await Promise.all(
      targets.map(async ([label, path]): Promise<TestProbe> => {
        try {
          await fetchBackendJson<unknown>(path, {
            method: 'GET',
            cache: 'no-store',
          });
          return { label, ok: true };
        } catch {
          return { label, ok: false };
        }
      }),
    );

    const probes: TestProbe[] = [
      { label: 'Paper safety lock', ok: systemMode.toLowerCase() === 'paper' },
      ...remoteProbes,
    ];

    setDashboardTest({
      running: false,
      ranAt: new Date().toISOString(),
      probes,
    });

    const passed = probes.filter((probe) => probe.ok).length;
    if (passed === probes.length) {
      toast.success(`Dashboard certification test passed ${passed}/${probes.length}.`);
    } else {
      toast.warning(`Dashboard certification test passed ${passed}/${probes.length}. Review failed checks.`);
    }
  };

  const runPaperTradeTest = async () => {
    if (paperTradeTest.running) return;

    if (systemMode.toLowerCase() !== 'paper') {
      toast.error('Paper trade test blocked: runtime is not in paper mode.');
      return;
    }
    if (!backendConnected) {
      toast.error('Paper trade test blocked: backend is offline.');
      return;
    }
    if (killSwitchActive) {
      toast.error('Paper trade test blocked: Guardian kill switch is active.');
      return;
    }

    setPaperTradeTest({ running: true, ranAt: null, error: null, result: null });

    try {
      const before = await fetchBackendJson<PaperPortfolioSummary>(PAPER_DASHBOARD_ROUTES.portfolioSummary, {
        method: 'GET',
        cache: 'no-store',
      });
      const cashBefore = Number(before.cash_usdt ?? before.balance_usdt ?? certificationBalance);
      if (!Number.isFinite(cashBefore) || cashBefore <= 0) {
        throw new Error('Paper cash balance is unavailable.');
      }

      const runtimeMode = String(before.mode ?? systemMode).toLowerCase();
      if (runtimeMode !== 'paper') {
        throw new Error(`Paper trade blocked because portfolio mode is ${runtimeMode || 'unknown'}.`);
      }

      const priceSnapshot = await fetchBackendJson<PaperPriceSnapshot>('/price?symbol=BTCUSDT', {
        method: 'GET',
        cache: 'no-store',
      });
      const fillReference = Number(priceSnapshot.price);
      if (!Number.isFinite(fillReference) || fillReference <= 0) {
        throw new Error('BTC paper reference price is unavailable.');
      }

      // The default certification wallet is 10,000 USDT. Use a bounded 5% test
      // position so the trade is large enough to visibly exercise cash, order,
      // position and audit flows without consuming the full demo portfolio.
      const testNotional = Math.min(500, cashBefore * 0.05);
      if (testNotional < 10) {
        throw new Error('Paper balance is too small for the certification trade test.');
      }
      const quantity = Number((testNotional / fillReference).toFixed(8));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Unable to calculate a valid BTC paper quantity.');
      }

      const trade = await fetchBackendJson<PaperTradeResponse>('/intent/paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'BTCUSDT',
          side: 'BUY',
          order_type: 'MARKET',
          quantity,
          price: fillReference,
        }),
      });

      if (String(trade.status ?? '').toUpperCase() !== 'FILLED') {
        throw new Error(`Paper order was not filled${trade.status ? ` (${trade.status})` : ''}.`);
      }

      const after = await fetchBackendJson<PaperPortfolioSummary>(PAPER_DASHBOARD_ROUTES.portfolioSummary, {
        method: 'GET',
        cache: 'no-store',
      });
      const fillPrice = Number(trade.fill_price ?? trade.price ?? fillReference);
      const actualQuantity = Number(trade.quantity ?? quantity);
      const actualNotional = Number(trade.notional_usdt ?? actualQuantity * fillPrice);
      const cashAfter = Number(after.cash_usdt ?? after.balance_usdt);
      const equityAfter = Number(after.equity_usdt ?? cashAfter + actualNotional);
      const orderId = String(trade.id ?? trade.order_id ?? `paper-${Date.now()}`);

      setPaperTradeTest({
        running: false,
        ranAt: new Date().toISOString(),
        error: null,
        result: {
          orderId,
          symbol: String(trade.symbol ?? 'BTC'),
          side: String(trade.side ?? 'BUY').toUpperCase(),
          quantity: actualQuantity,
          fillPrice,
          notionalUsdt: actualNotional,
          cashBefore,
          cashAfter: Number.isFinite(cashAfter) ? cashAfter : cashBefore - actualNotional,
          equityAfter: Number.isFinite(equityAfter) ? equityAfter : cashBefore,
        },
      });

      toast.success(`Paper BTC test filled for ${currencyFormatter.format(actualNotional)} from the demo wallet.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Paper trade test failed.';
      setPaperTradeTest({
        running: false,
        ranAt: new Date().toISOString(),
        error: message,
        result: null,
      });
      toast.error(message);
    }
  };

  const statusLabel = !backendConnected
    ? 'OFFLINE'
    : killSwitchActive
    ? 'HALTED'
    : 'ONLINE';

  const statusDotClass = !backendConnected
    ? 'bg-muted-foreground'
    : killSwitchActive
    ? 'bg-destructive'
    : 'bg-accent';

  const statusChipClass = !backendConnected
    ? ''
    : killSwitchActive
    ? 'status-chip-danger'
    : 'status-chip-online';

  const certificationBalanceLabel =
    typeof certificationBalance === 'number'
      ? currencyFormatter.format(certificationBalance)
      : 'Unavailable';

  const passedTestCount = dashboardTest.probes.filter((probe) => probe.ok).length;

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="container mx-auto px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative shrink-0">
              <div className="rounded-xl border border-primary/25 bg-primary/10 p-2.5 shadow-neon-cyan">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background ${statusDotClass} ${backendConnected && !killSwitchActive ? 'animate-pulse' : ''}`} />
            </div>

            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="truncate font-display text-base font-bold tracking-wide text-gradient-cyber sm:text-lg">
                  CRYPTO SIGNAL BOT
                </h1>
                <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground xl:inline">
                  V2
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                Certification trading terminal
              </p>
            </div>
          </div>

          <div className="hidden flex-1 items-center justify-center gap-2 xl:flex">
            <span className="status-chip status-chip-warning">
              {systemMode.toUpperCase()} / TESTNET
            </span>
            <span className="status-chip">
              BTCC PRIMARY <span className="text-primary">→</span> BITGET SECONDARY
            </span>
            <span className={`status-chip ${statusChipClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
              BACKEND {statusLabel}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-3 py-1.5 md:flex">
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <div>
                <div className="metric-label">Paper equity</div>
                <div className="font-mono text-xs font-semibold tabular-nums text-foreground">
                  {certificationBalanceLabel}
                </div>
              </div>
            </div>

            {user?.email && (
              <div className="hidden max-w-[180px] truncate font-mono text-[10px] text-muted-foreground 2xl:block">
                {user.email}
              </div>
            )}

            <Button
              variant="outline"
              onClick={() => void runDashboardTest()}
              disabled={dashboardTest.running || paperTradeTest.running}
              className="h-9 gap-2 border-accent/50 bg-accent/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-accent hover:border-accent hover:bg-accent/15 disabled:cursor-wait"
              title="Run read-only dashboard certification test"
            >
              {dashboardTest.running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TestTube2 className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {dashboardTest.running ? 'Testing…' : 'Run Test'}
              </span>
            </Button>

            <Button
              variant="outline"
              onClick={() => void runPaperTradeTest()}
              disabled={paperTradeTest.running || dashboardTest.running || !backendConnected || killSwitchActive || systemMode.toLowerCase() !== 'paper'}
              className="h-9 gap-2 border-warning/50 bg-warning/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-warning hover:border-warning hover:bg-warning/15 disabled:cursor-not-allowed"
              title="Place one bounded BTC paper trade using 5% of the certification wallet (maximum $500)"
            >
              {paperTradeTest.running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              <span className="hidden lg:inline">
                {paperTradeTest.running ? 'Paper trade…' : 'Test Paper Trade'}
              </span>
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate('/status')}
              className="h-9 w-9 border-border/80 bg-card/50 hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
              title="Production status"
            >
              <ShieldCheck className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={onSettingsClick}
              className="h-9 w-9 border-border/80 bg-card/50 hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
              title="Dashboard settings"
            >
              <Settings className="h-4 w-4" />
            </Button>

            {SUPABASE_CONFIGURED && (
              <Button
                variant="outline"
                size="icon"
                onClick={handleSignOut}
                className="h-9 w-9 border-border/80 bg-card/50 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5 xl:hidden">
          <span className="status-chip status-chip-warning shrink-0">
            {systemMode.toUpperCase()} / TESTNET
          </span>
          <span className="status-chip shrink-0">
            BTCC <span className="text-primary">→</span> BITGET
          </span>
          <span className={`status-chip shrink-0 ${statusChipClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
            {statusLabel}
          </span>
        </div>
      </div>

      {(dashboardTest.running || dashboardTest.probes.length > 0) && (
        <div className="border-t border-border/70 bg-card/40 px-4 py-2 lg:px-6">
          <div className="container mx-auto flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
              {dashboardTest.running
                ? 'DASHBOARD TEST — RUNNING'
                : `DASHBOARD TEST — ${passedTestCount}/${dashboardTest.probes.length} PASS`}
            </span>

            {!dashboardTest.running && dashboardTest.probes.map((probe) => (
              <span
                key={probe.label}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[9px] ${
                  probe.ok
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                }`}
              >
                {probe.ok ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {probe.label}
              </span>
            ))}

            {dashboardTest.ranAt && (
              <span className="font-mono text-[9px] text-muted-foreground">
                {new Date(dashboardTest.ranAt).toLocaleTimeString()}
              </span>
            )}

            <span className="ml-auto font-mono text-[9px] text-muted-foreground">
              Read-only certification test — no orders, withdrawals, or provider mutation.
            </span>
          </div>
        </div>
      )}

      {(paperTradeTest.running || paperTradeTest.result || paperTradeTest.error) && (
        <div className="border-t border-border/70 bg-card/60 px-4 py-2 lg:px-6">
          <div className="container mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px]">
            {paperTradeTest.running && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" />
                <span className="font-bold text-warning">PAPER TRADE TEST — EXECUTING BTC BUY</span>
                <span className="text-muted-foreground">Uses 5% of paper cash, capped at $500.</span>
              </>
            )}

            {paperTradeTest.result && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                <span className="font-bold text-accent">PAPER TRADE FILLED</span>
                <span>{paperTradeTest.result.side} {quantityFormatter.format(paperTradeTest.result.quantity)} {paperTradeTest.result.symbol}</span>
                <span>@ {currencyFormatter.format(paperTradeTest.result.fillPrice)}</span>
                <span>Notional {currencyFormatter.format(paperTradeTest.result.notionalUsdt)}</span>
                <span>Cash {currencyFormatter.format(paperTradeTest.result.cashBefore)} → {currencyFormatter.format(paperTradeTest.result.cashAfter)}</span>
                <span>Equity {currencyFormatter.format(paperTradeTest.result.equityAfter)}</span>
                <span className="break-all text-muted-foreground">Order {paperTradeTest.result.orderId}</span>
              </>
            )}

            {paperTradeTest.error && (
              <>
                <XCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="font-bold text-destructive">PAPER TRADE TEST FAILED</span>
                <span className="text-destructive/80">{paperTradeTest.error}</span>
              </>
            )}

            {paperTradeTest.ranAt && !paperTradeTest.running && (
              <span className="ml-auto text-muted-foreground">
                {new Date(paperTradeTest.ranAt).toLocaleTimeString()} · Paper/testnet only · no real funds
              </span>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
