import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/dashboard/Header';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
import { AuditTrailPanel } from '@/components/dashboard/AuditTrailPanel';
import { EarningsPanel } from '@/components/dashboard/EarningsPanel';
import { GuardianPanel } from '@/components/dashboard/GuardianPanel';
import { MicrostructureDisplay } from '@/components/dashboard/MicrostructureDisplay';
import { PortfolioPanel } from '@/components/dashboard/PortfolioPanel';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { PriceTicker } from '@/components/dashboard/PriceTicker';
import { RiskGauge } from '@/components/dashboard/RiskGauge';
import { SettingsModal } from '@/components/dashboard/SettingsModal';
import type { UserSettings } from '@/components/dashboard/SettingsModal';
import { SignalPanel } from '@/components/dashboard/SignalPanel';
import { SystemMetricsPanel } from '@/components/dashboard/SystemMetricsPanel';
import { useBackendStatus, type EndpointErrors } from '@/hooks/useBackendStatus';
import { useBackendWebSocket, type WsTickerMessage, type WsHealthMessage } from '@/hooks/useBackendWebSocket';
import { useCryptoPrices } from '@/hooks/useCryptoPrices';
import { useEarnings } from '@/hooks/useEarnings';
import { useAuditTrail } from '@/hooks/useAuditTrail';
import { useBackendMetrics } from '@/hooks/useBackendMetrics';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { usePersistedSettings } from '@/hooks/usePersistedSettings';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useSignalEngine } from '@/hooks/useSignalEngine';
import { useConsole } from '@/hooks/useConsole';
import { useMonitoring } from '@/hooks/useMonitoring';
import { CommandConsolePanel } from '@/components/dashboard/CommandConsolePanel';
import { MonitoringPanel } from '@/components/dashboard/MonitoringPanel';
import { fetchBackendJson } from '@/lib/backend';
import { SurgePanel } from '@/components/dashboard/SurgePanel';
import { useSurgeScanner } from '@/hooks/useSurgeScanner';
import { useAuth } from '@/context/AuthContext';

function CertificationModeBanner() {
  return (
    <div className="bg-amber-500/90 text-black py-2 px-4 text-center font-mono text-sm">
      <span className="font-bold">CERTIFICATION MODE</span> — Real-market rehearsal; provider mutation and funds movement remain locked.
    </div>
  );
}

function DiagnosticsWarning({
  endpointErrors,
  backendUrl,
}: {
  endpointErrors: EndpointErrors;
  backendUrl: string;
}) {
  const failedEndpoints: string[] = [];
  if (endpointErrors.balanceError) failedEndpoints.push('balance');
  if (endpointErrors.configError) failedEndpoints.push('config');
  if (endpointErrors.exchangeStatusError) failedEndpoints.push('exchange status');

  if (failedEndpoints.length === 0) return null;

  return (
    <div className="cyber-card p-4 border-warning bg-warning/10">
      <p className="text-warning font-mono text-sm">
        Backend is online, but some diagnostics are unavailable: {failedEndpoints.join(', ')}.
      </p>
      <details className="mt-2">
        <summary className="text-warning/70 font-mono text-xs cursor-pointer">
          Diagnostics details
        </summary>
        <div className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
          <p>Backend URL: {backendUrl}</p>
          {endpointErrors.balanceError && (
            <p>Balance error: {endpointErrors.balanceError}</p>
          )}
          {endpointErrors.configError && (
            <p>Config error: {endpointErrors.configError}</p>
          )}
          {endpointErrors.exchangeStatusError && (
            <p>Exchange status error: {endpointErrors.exchangeStatusError}</p>
          )}
        </div>
      </details>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-primary/70">{eyebrow}</p>
        <h2 className="font-display text-lg font-semibold tracking-wide text-foreground">{title}</h2>
      </div>
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-right">{description}</p>
    </div>
  );
}

function StatusTile({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'primary';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-accent'
      : tone === 'warning'
      ? 'text-warning'
      : tone === 'danger'
      ? 'text-destructive'
      : tone === 'primary'
      ? 'text-primary'
      : 'text-foreground';

  return (
    <div className="cyber-card min-h-[104px] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={`mt-2 font-display text-sm font-semibold tracking-wide ${toneClass}`}>{value}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('bitcoin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [operationsView, setOperationsView] = useState<'audit' | 'system' | 'command' | 'monitoring'>('audit');
  const { settings, setSettings } = usePersistedSettings();
  const { isDemoMode } = useAuth();

  const { health, config, exchangeStatus, paperBalance, isConnected, isLoading: backendLoading, endpointErrors, backendUrl, refetch: refetchStatus } = useBackendStatus();
  const systemMode = health?.mode ?? 'paper';
  const preferBackendPrices = exchangeStatus?.market_data_mode === 'live_public_paper';
  const { prices, isLoading, error, source: priceSource, refetch: refetchPrices } = useCryptoPrices(
    undefined,
    preferBackendPrices
  );
  const { guardian, isLoading: guardianLoading, refetch: refetchGuardian } = useGuardianStatus();
  const { portfolio, isLoading: portfolioLoading, refetch: refetchPortfolio } = usePortfolio();
  const { summary: earningsSummary, trades: earningsTrades, isLoading: earningsLoading, refetch: refetchEarnings } = useEarnings();
  const { audit, isLoading: auditLoading, refetch: refetchAudit } = useAuditTrail();
  const {
    status: consoleStatus, isLoading: consoleLoading, refetch: refetchConsole,
    submitTrade, toggleKillSwitch, setSignalOverride, cancelSignalOverride,
    reEvalSignals, resetGuardian, resetPortfolio,
  } = useConsole();
  const { status: monitorStatus, isLoading: monitorLoading, runNow, refetch: refetchMonitor } = useMonitoring();
  const { metrics, isLoading: metricsLoading, error: metricsError, refetch: refetchMetrics } = useBackendMetrics();
  const [surgeSound, setSurgeSound] = useState<boolean>(() => {
    try { return localStorage.getItem('surge_sound_enabled') !== 'false'; } catch { return true; }
  });
  const toggleSurgeSound = () => setSurgeSound((v) => {
    const next = !v;
    try {
      localStorage.setItem('surge_sound_enabled', String(next));
    } catch (e) {
      console.warn('Failed to persist surge sound setting', e);
    }
    return next;
  });
  const { status: surgeStatus, isLoading: surgeLoading, error: surgeError, refetch: refetchSurge } = useSurgeScanner(surgeSound);
  const selectedCoin = prices.find((price) => price.id === selectedSymbol) || null;

  const { signal, risk, microstructure, isLoading: signalLoading, refreshLatest: refreshLatestSignal } = useSignalEngine(selectedCoin, {
    riskTolerance: settings.riskTolerance,
    spreadStressThreshold: settings.spreadStressThreshold,
    volatilitySensitivity: settings.volatilitySensitivity,
    positionSizeFraction: settings.positionSizeFraction,
  });
  const selectedBackendSymbol = selectedCoin ? `${selectedCoin.symbol.toUpperCase()}USDT` : null;

  const lastAutoTradeSig = useRef<string | null>(null);

  useEffect(() => {
    if (
      !settings.autoTradeEnabled ||
      !signal ||
      !risk ||
      !risk.approved ||
      !selectedCoin ||
      health?.kill_switch_active
    ) {
      return;
    }

    if (systemMode === 'live') {
      toast.warning('Auto-trade skipped: live execution is disabled. Certification controls remain enforced.', { duration: 5000 });
      return;
    }

    const sig = `${selectedCoin.id}:${signal.direction}:${signal.regime}`;
    if (sig === lastAutoTradeSig.current) return;
    lastAutoTradeSig.current = sig;

    const side = signal.direction === 'DOWN' ? 'SELL' : 'BUY';
    const qty = selectedCoin.price > 0
      ? Number(((risk.positionSize * 1000) / selectedCoin.price).toFixed(6))
      : 0.001;

    fetchBackendJson('/intent/paper', {
      method: 'POST',
      body: JSON.stringify({
        symbol: `${selectedCoin.symbol.toUpperCase()}USDT`,
        side,
        order_type: 'MARKET',
        quantity: Math.max(qty, 0.0001),
        price: selectedCoin.price,
      }),
    })
      .then(() => {
        toast.info(
          `Certification rehearsal: ${side} ${selectedCoin.symbol} (confidence ${signal.confidence}%)`,
          { duration: 5000 }
        );
        refetchPortfolio();
        refetchAudit();
        refetchMetrics();
        refetchStatus();
      })
      .catch(() => {
        // Silently swallow — guardian, balance, or risk rejection; next poll will re-evaluate.
      });
  }, [
    health?.kill_switch_active,
    refetchAudit,
    refetchMetrics,
    refetchPortfolio,
    refetchStatus,
    risk,
    selectedCoin,
    settings.autoTradeEnabled,
    signal,
    systemMode,
  ]);

  const handleHealthUpdate = useCallback(
    (_msg: WsHealthMessage) => {
      refetchStatus();
    },
    [refetchStatus]
  );

  const handleGuardianAlert = useCallback(
    (msg: { reason: string; kill_switch_active: boolean }) => {
      toast.error(`Guardian alert: ${msg.reason}`, { duration: 8000 });
      refetchStatus();
      refetchGuardian();
      refetchAudit();
      refetchMetrics();
    },
    [refetchStatus, refetchGuardian, refetchAudit, refetchMetrics]
  );

  const handleKillSwitchChange = useCallback(() => {
    refetchStatus();
    refetchGuardian();
    refetchAudit();
    refetchMetrics();
  }, [refetchStatus, refetchGuardian, refetchAudit, refetchMetrics]);

  const handleMarketUpdate = useCallback(() => {
    if (preferBackendPrices) {
      refetchPrices();
    }
    refreshLatestSignal();
  }, [preferBackendPrices, refetchPrices, refreshLatestSignal]);

  const handleExchangeStatus = useCallback(() => {
    refetchStatus();
    refetchGuardian();
    if (preferBackendPrices) {
      refetchPrices();
    }
    refreshLatestSignal();
  }, [preferBackendPrices, refetchGuardian, refetchPrices, refetchStatus, refreshLatestSignal]);

  const handleOrderUpdate = useCallback(
    (msg: { status: string; symbol: string; side: string; fill_price: number | null }) => {
      if (msg.status === 'FILLED') {
        toast.success(
          `Order filled: ${msg.side} ${msg.symbol}${msg.fill_price ? ` @ ${msg.fill_price}` : ''}`
        );
        refetchStatus();
        refetchPortfolio();
        refetchEarnings();
        refetchAudit();
        refetchMetrics();
        const normalizedMsgSymbol = msg.symbol.toUpperCase().replace(/(USDT|USD)$/i, '');
        const normalizedSelectedSymbol = selectedBackendSymbol?.replace(/(USDT|USD)$/i, '');
        if (!normalizedSelectedSymbol || normalizedMsgSymbol === normalizedSelectedSymbol) {
          refreshLatestSignal();
        }
      }
    },
    [refetchStatus, refetchPortfolio, refetchEarnings, refetchAudit, refetchMetrics, refreshLatestSignal, selectedBackendSymbol]
  );

  const handlePortfolioActionComplete = useCallback(() => {
    refetchStatus();
    refetchGuardian();
    refetchPortfolio();
    refetchEarnings();
    refetchAudit();
    refetchMetrics();
  }, [refetchStatus, refetchGuardian, refetchPortfolio, refetchEarnings, refetchAudit, refetchMetrics]);

  const handleEarningsReset = useCallback(() => {
    refetchEarnings();
    refetchAudit();
    refetchMetrics();
  }, [refetchEarnings, refetchAudit, refetchMetrics]);

  const handleTickerUpdate = useCallback(
    (_msg: WsTickerMessage) => {
      // Ticker updates are currently consumed through REST refreshes.
    },
    []
  );

  const { connected: wsConnected } = useBackendWebSocket({
    onHealthUpdate: handleHealthUpdate,
    onExchangeStatus: handleExchangeStatus,
    onGuardianAlert: handleGuardianAlert,
    onKillSwitchChange: handleKillSwitchChange,
    onMarketUpdate: handleMarketUpdate,
    onOrderUpdate: handleOrderUpdate,
    onTickerUpdate: handleTickerUpdate,
  });

  const handleSettingsChange = (newSettings: UserSettings) => {
    setSettings(newSettings);
    lastAutoTradeSig.current = null;
    toast.success('Settings updated successfully');
  };

  const showReadinessGate = backendLoading && !isConnected && !health;

  const footerLabel = !isConnected
    ? 'BACKEND DISCONNECTED'
    : health?.kill_switch_active
    ? `TRADING HALTED${health.kill_switch_reason ? ` // ${health.kill_switch_reason}` : ''}`
    : 'SYSTEM OPERATIONAL';

  const footerDotClass = !isConnected
    ? 'bg-muted-foreground'
    : health?.kill_switch_active
    ? 'bg-destructive'
    : 'bg-accent';

  const guardianState = guardian?.kill_switch_active
    ? 'HALTED'
    : guardian?.triggered
    ? 'ALERT'
    : guardian
    ? 'NOMINAL'
    : 'UNKNOWN';

  const guardianTone = guardian?.kill_switch_active
    ? 'danger'
    : guardian?.triggered
    ? 'warning'
    : guardian
    ? 'positive'
    : 'neutral';

  const signalLabel = signal
    ? `${signal.direction} · ${signal.confidence}%`
    : 'WAITING';

  const riskLabel = risk
    ? risk.approved
      ? 'APPROVED'
      : 'BLOCKED'
    : 'PENDING';

  const marketDataLabel = exchangeStatus?.market_data_mode === 'live_public_paper'
    ? 'PUBLIC LIVE'
    : priceSource === 'coingecko'
    ? 'COINGECKO'
    : priceSource === 'backend-live'
    ? 'BACKEND LIVE'
    : 'CERTIFICATION';

  if (showReadinessGate) {
    return (
      <div className="min-h-screen bg-background scanlines flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 font-mono">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">Connecting to backend...</p>
          <p className="text-xs text-muted-foreground/60">{backendUrl}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background scanlines">
      {isDemoMode && <CertificationModeBanner />}
      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        backendConnected={isConnected}
        killSwitchActive={health?.kill_switch_active}
        certificationBalance={paperBalance}
        systemMode={systemMode}
      />

      <PriceTicker
        prices={prices}
        selectedSymbol={selectedSymbol}
        onSelect={setSelectedSymbol}
      />

      <main className="container mx-auto space-y-6 p-4 lg:space-y-8 lg:p-6">
        {error && !isConnected && (
          <div className="cyber-card p-3 border-border/40 bg-muted/20">
            <p className="text-muted-foreground font-mono text-xs">⚠ Price data: {error} — retrying…</p>
          </div>
        )}

        {!isConnected && (
          <div className="cyber-card p-4 border-destructive bg-destructive/10">
            <p className="text-destructive font-mono text-sm">
              Backend unavailable. Market state, health, and certification balance are offline.
            </p>
            <p className="text-destructive/70 font-mono text-xs mt-2">
              Backend URL: {backendUrl}
            </p>
          </div>
        )}

        {isConnected && (endpointErrors.balanceError || endpointErrors.configError || endpointErrors.exchangeStatusError) && (
          <DiagnosticsWarning endpointErrors={endpointErrors} backendUrl={backendUrl} />
        )}

        <section className="space-y-3">
          <SectionHeading
            eyebrow="Command snapshot"
            title="Execution & Decision State"
            description="Execution route, Guardian authority, decision quality and connectivity are visible before deeper analysis."
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatusTile
              label="Execution Route"
              value="BTCC → BITGET"
              detail="Primary execution venue with failover hierarchy preserved."
              tone="primary"
            />
            <StatusTile
              label="Guardian"
              value={guardianState}
              detail={guardian?.kill_switch_reason || guardian?.trigger_reason || 'No active Guardian halt condition.'}
              tone={guardianTone}
            />
            <StatusTile
              label="Signal / Risk"
              value={`${signalLabel} · ${riskLabel}`}
              detail={selectedCoin ? `${selectedCoin.symbol.toUpperCase()} decision state` : 'Select a market to evaluate.'}
              tone={risk?.approved ? 'positive' : risk ? 'warning' : 'neutral'}
            />
            <StatusTile
              label="Connectivity"
              value={isConnected ? (wsConnected ? 'REST + WS ONLINE' : 'REST ONLINE') : 'OFFLINE'}
              detail={`${marketDataLabel} market data · ${systemMode.toUpperCase()} / TESTNET`}
              tone={isConnected ? 'positive' : 'danger'}
            />
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeading
            eyebrow="Primary workspace"
            title="Market Decision Deck"
            description="Price context and market evidence stay on the left; signal, risk and Guardian authority stay together on the decision rail."
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-6">
            <div className="space-y-4 xl:col-span-8 xl:space-y-6">
              <PriceChart price={selectedCoin} isLoading={isLoading} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
                <MicrostructureDisplay features={microstructure} isLoading={isLoading || signalLoading} />
                <AIInsightCard
                  selectedCoin={selectedCoin}
                  signal={signal?.direction}
                  riskScore={risk?.score}
                />
              </div>
            </div>

            <aside className="space-y-4 xl:col-span-4 xl:space-y-6">
              <SignalPanel signal={signal} isLoading={isLoading || signalLoading} />
              <RiskGauge risk={risk} isLoading={isLoading || signalLoading} />
              <GuardianPanel
                guardian={guardian}
                isLoading={guardianLoading}
                authEnabled={config?.auth_enabled}
                onKillSwitchToggle={() => {
                  refetchGuardian();
                  refetchStatus();
                }}
              />
            </aside>
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeading
            eyebrow="Exposure"
            title="Portfolio & P&L"
            description="Position management and certification earnings are separated from signal generation so exposure remains readable as its own layer."
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
            <div className="lg:col-span-8">
              <PortfolioPanel
                portfolio={portfolio}
                isLoading={portfolioLoading}
                selectedSymbol={selectedCoin?.symbol ?? 'BTC'}
                selectedPrice={selectedCoin?.price ?? 0}
                signal={signal}
                risk={risk}
                onRefetch={refetchPortfolio}
                onActionComplete={handlePortfolioActionComplete}
                tradingMode={systemMode}
              />
            </div>
            <div className="lg:col-span-4">
              <EarningsPanel
                summary={earningsSummary}
                trades={earningsTrades}
                isLoading={earningsLoading}
                onReset={handleEarningsReset}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeading
            eyebrow="Opportunity scanner"
            title="Market Surge Detection"
            description="Fast-moving market opportunities remain visible without competing with the core price, signal and Guardian decision workflow."
          />
          <SurgePanel
            status={surgeStatus}
            isLoading={surgeLoading}
            error={surgeError}
            onRefetch={refetchSurge}
            soundEnabled={surgeSound}
            onToggleSound={toggleSurgeSound}
          />
        </section>

        <section className="space-y-3">
          <SectionHeading
            eyebrow="Operations"
            title="Evidence & Control Layer"
            description="Operational evidence, telemetry and controls are one click away instead of occupying the trading decision surface at all times."
          />

          <div className="cyber-card p-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4" role="tablist" aria-label="Operations workspace">
              {(['audit', 'system', 'command', 'monitoring'] as const).map((view) => {
                const labels = {
                  audit: 'Audit Trail',
                  system: 'System Metrics',
                  command: 'Command Console',
                  monitoring: 'Monitoring',
                };
                const active = operationsView === view;
                return (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setOperationsView(view)}
                    className={`rounded-md border px-3 py-2.5 text-left font-mono text-xs uppercase tracking-[0.12em] transition ${
                      active
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/60 bg-muted/10 text-muted-foreground hover:border-primary/30 hover:bg-muted/30 hover:text-foreground'
                    }`}
                  >
                    {labels[view]}
                  </button>
                );
              })}
            </div>
          </div>

          <div role="tabpanel">
            {operationsView === 'audit' && (
              <AuditTrailPanel
                audit={audit}
                isLoading={auditLoading}
                onRefetch={refetchAudit}
              />
            )}

            {operationsView === 'system' && (
              <SystemMetricsPanel
                metrics={metrics}
                isLoading={metricsLoading}
                error={metricsError}
                onRefetch={refetchMetrics}
              />
            )}

            {operationsView === 'command' && (
              <CommandConsolePanel
                status={consoleStatus}
                isLoading={consoleLoading}
                onSubmitTrade={submitTrade}
                onToggleKillSwitch={toggleKillSwitch}
                onSetSignalOverride={setSignalOverride}
                onCancelSignalOverride={cancelSignalOverride}
                onReEvalSignals={reEvalSignals}
                onResetGuardian={resetGuardian}
                onResetPortfolio={resetPortfolio}
                onRefetch={refetchConsole}
              />
            )}

            {operationsView === 'monitoring' && (
              <MonitoringPanel
                status={monitorStatus}
                isLoading={monitorLoading}
                onRunNow={runNow}
                onRefetch={refetchMonitor}
              />
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-muted/20 py-4 mt-8">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
          <span>
            CRYPTO SIGNAL BOT v2.4
            {priceSource && (
              <span className="ml-2 opacity-60">
                // PRICES: {priceSource === 'coingecko'
                  ? 'COINGECKO LIVE'
                  : priceSource === 'backend-live'
                  ? 'BACKEND LIVE CERTIFICATION'
                  : 'BACKEND SYNTHETIC'}
              </span>
            )}
            {settings.autoTradeEnabled && (
              <span className="ml-2 text-accent opacity-80">// CERTIFICATION AUTO-REHEARSAL ON</span>
            )}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent animate-pulse' : 'bg-muted-foreground'}`} />
              {wsConnected ? 'WS ONLINE' : 'WS OFFLINE'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${footerDotClass} ${isConnected && !health?.kill_switch_active ? 'animate-pulse' : ''}`} />
              {footerLabel}
            </span>
          </span>
        </div>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        systemMode={systemMode}
      />
    </div>
  );
};

export default Index;