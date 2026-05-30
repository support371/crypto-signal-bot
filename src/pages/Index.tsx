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
import { useBackendWebSocket, type WsTickerMessage } from '@/hooks/useBackendWebSocket';
import { useCryptoPrices } from '@/hooks/useCryptoPrices';
import { useEarnings } from '@/hooks/useEarnings';
import { useAuditTrail } from '@/hooks/useAuditTrail';
import { useBackendMetrics } from '@/hooks/useBackendMetrics';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { usePersistedSettings } from '@/hooks/usePersistedSettings';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useSignalEngine } from '@/hooks/useSignalEngine';
import { fetchBackendJson } from '@/lib/backend';
import { useAuth } from '@/context/AuthContext';

/**
 * DemoModeBanner displays a warning when running in demo mode.
 * Live trading is disabled in demo mode.
 */
function DemoModeBanner() {
  return (
    <div className="bg-amber-500/90 text-black py-2 px-4 text-center font-mono text-sm">
      <span className="font-bold">DEMO PAPER MODE</span> — Auth disabled, live trading unavailable. For evaluation only.
    </div>
  );
}

/**
 * DiagnosticsWarning displays a warning when optional endpoints fail
 * but the backend health check is still successful.
 */
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

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('bitcoin');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const { metrics, isLoading: metricsLoading, error: metricsError, refetch: refetchMetrics } = useBackendMetrics();
  const selectedCoin = prices.find((price) => price.id === selectedSymbol) || null;

  const { signal, risk, microstructure, isLoading: signalLoading, refreshLatest: refreshLatestSignal } = useSignalEngine(selectedCoin, {
    riskTolerance: settings.riskTolerance,
    spreadStressThreshold: settings.spreadStressThreshold,
    volatilitySensitivity: settings.volatilitySensitivity,
    positionSizeFraction: settings.positionSizeFraction,
  });
  const selectedBackendSymbol = selectedCoin ? `${selectedCoin.symbol.toUpperCase()}USDT` : null;

  // Auto-trade: fire an intent whenever signal flips and autoTradeEnabled is on.
  // Use a ref to avoid re-firing on every render for the same signal direction.
  const lastAutoTradeSig = useRef<string | null>(null);

  useEffect(() => {
    // Never allow live trading in demo mode
    if (isDemoMode && systemMode === 'live') {
      return;
    }

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

    const sig = `${selectedCoin.id}:${signal.direction}:${signal.regime}`;
    if (sig === lastAutoTradeSig.current) return;
    lastAutoTradeSig.current = sig;

    const side = signal.direction === 'DOWN' ? 'SELL' : 'BUY';
    const qty = selectedCoin.price > 0
      ? Number(((risk.positionSize * 1000) / selectedCoin.price).toFixed(6))
      : 0.001;

    const intentPath = systemMode === 'live' ? '/intent/live' : '/intent/paper';
    fetchBackendJson(intentPath, {
      method: 'POST',
      body: JSON.stringify({
        symbol: `${selectedCoin.symbol.toUpperCase()}USDT`,
        side,
        order_type: 'MARKET',
        quantity: Math.max(qty, 0.0001),
      }),
    })
      .then(() => {
        toast.info(
          `Auto-trade: ${systemMode} ${side} ${selectedCoin.symbol} (confidence ${signal.confidence}%)`,
          { duration: 5000 }
        );
        refetchPortfolio();
        refetchAudit();
        refetchMetrics();
        refetchStatus();
      })
      .catch(() => {
        // Silently swallow — kill switch or risk rejection; next poll will re-evaluate.
      });
  }, [
    health?.kill_switch_active,
    isDemoMode,
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
        if (!selectedBackendSymbol || msg.symbol === selectedBackendSymbol) {
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
    (msg: WsTickerMessage) => {
      // Ticker updates drive the marquee values via WS — no action needed here
      // as prices are fetched via REST. Could be used for real-time price overlay.
    },
    []
  );

  const { connected: wsConnected } = useBackendWebSocket({
    onExchangeStatus: handleExchangeStatus,
    onGuardianAlert: handleGuardianAlert,
    onKillSwitchChange: handleKillSwitchChange,
    onMarketUpdate: handleMarketUpdate,
    onOrderUpdate: handleOrderUpdate,
    onTickerUpdate: handleTickerUpdate,
  });

  const handleSettingsChange = (newSettings: UserSettings) => {
    setSettings(newSettings);
    // Reset auto-trade guard so the new signal direction fires immediately.
    lastAutoTradeSig.current = null;
    toast.success('Settings updated successfully');
  };

  // Backend readiness gate — show connecting screen before dashboard init
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
      {isDemoMode && <DemoModeBanner />}
      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        backendConnected={isConnected}
        killSwitchActive={health?.kill_switch_active}
        paperBalance={paperBalance}
        systemMode={systemMode}
      />

      <PriceTicker
        prices={prices}
        selectedSymbol={selectedSymbol}
        onSelect={setSelectedSymbol}
      />

      <main className="container mx-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
        {error && (
          <div className="cyber-card p-4 border-destructive bg-destructive/10">
            <p className="text-destructive font-mono text-sm">⚠ {error}</p>
          </div>
        )}

        {!isConnected && (
          <div className="cyber-card p-4 border-destructive bg-destructive/10">
            <p className="text-destructive font-mono text-sm">
              Backend unavailable. Market state, health, and paper balance are offline.
            </p>
            <p className="text-destructive/70 font-mono text-xs mt-2">
              Backend URL: {backendUrl}
            </p>
          </div>
        )}

        {isConnected && (endpointErrors.balanceError || endpointErrors.configError || endpointErrors.exchangeStatusError) && (
          <DiagnosticsWarning endpointErrors={endpointErrors} backendUrl={backendUrl} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          <div className="lg:col-span-8">
            <PriceChart price={selectedCoin} isLoading={isLoading} />
          </div>

          <div className="lg:col-span-4 space-y-4 lg:space-y-6">
            <SignalPanel signal={signal} isLoading={isLoading || signalLoading} />
            <RiskGauge risk={risk} isLoading={isLoading || signalLoading} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
          <MicrostructureDisplay features={microstructure} isLoading={isLoading || signalLoading} />
          <AIInsightCard
            selectedCoin={selectedCoin}
            signal={signal?.direction}
            riskScore={risk?.score}
          />
          <GuardianPanel
            guardian={guardian}
            isLoading={guardianLoading}
            authEnabled={config?.auth_enabled}
            onKillSwitchToggle={() => {
              refetchGuardian();
              refetchStatus();
            }}
          />
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
          <div className="lg:col-span-1">
            <div className="space-y-4 lg:space-y-6">
              <EarningsPanel
                summary={earningsSummary}
                trades={earningsTrades}
                isLoading={earningsLoading}
                onReset={handleEarningsReset}
              />
              <SystemMetricsPanel
                metrics={metrics}
                isLoading={metricsLoading}
                error={metricsError}
                onRefetch={refetchMetrics}
              />
            </div>
          </div>

          <div className="lg:col-span-3">
            <AuditTrailPanel
              audit={audit}
              isLoading={auditLoading}
              onRefetch={refetchAudit}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-border bg-muted/20 py-4 mt-8">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
          <span>
            CRYPTO SIGNAL BOT v2.3
            {priceSource && (
              <span className="ml-2 opacity-60">
                // PRICES: {priceSource === 'coingecko'
                  ? 'COINGECKO LIVE'
                  : priceSource === 'backend-live'
                  ? 'BACKEND LIVE PAPER'
                  : 'BACKEND SYNTHETIC'}
              </span>
            )}
            {settings.autoTradeEnabled && (
              <span className="ml-2 text-accent opacity-80">// AUTO-TRADE ON</span>
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
