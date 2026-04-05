import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/dashboard/Header';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
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
import { useBackendStatus } from '@/hooks/useBackendStatus';
import { useBackendWebSocket } from '@/hooks/useBackendWebSocket';
import { useCryptoPrices } from '@/hooks/useCryptoPrices';
import { useEarnings } from '@/hooks/useEarnings';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { usePersistedSettings } from '@/hooks/usePersistedSettings';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useSignalEngine } from '@/hooks/useSignalEngine';
import { fetchBackendJson } from '@/lib/backend';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('bitcoin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, setSettings } = usePersistedSettings();

  const { prices, isLoading, error, source: priceSource } = useCryptoPrices();
  const { health, config, paperBalance, isConnected, refetch: refetchStatus } = useBackendStatus();
  const { guardian, isLoading: guardianLoading, refetch: refetchGuardian } = useGuardianStatus();
  const { portfolio, isLoading: portfolioLoading, refetch: refetchPortfolio } = usePortfolio();
  const { summary: earningsSummary, trades: earningsTrades, isLoading: earningsLoading, refetch: refetchEarnings } = useEarnings();
  const selectedCoin = prices.find((price) => price.id === selectedSymbol) || null;

  const { signal, risk, microstructure } = useSignalEngine(selectedCoin, {
    riskTolerance: settings.riskTolerance,
    spreadStressThreshold: settings.spreadStressThreshold,
    volatilitySensitivity: settings.volatilitySensitivity,
    positionSizeFraction: settings.positionSizeFraction,
  });

  // Auto-trade: fire a paper intent whenever signal flips and autoTradeEnabled is on.
  // Use a ref to avoid re-firing on every render for the same signal direction.
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
      }),
    })
      .then(() => {
        toast.info(
          `Auto-trade: paper ${side} ${selectedCoin.symbol} (confidence ${signal.confidence}%)`,
          { duration: 5000 }
        );
        refetchPortfolio();
        refetchStatus();
      })
      .catch(() => {
        // Silently swallow — kill switch or risk rejection; next poll will re-evaluate.
      });
  }, [
    settings.autoTradeEnabled,
    signal?.direction,
    signal?.regime,
    signal?.confidence,
    risk?.approved,
    selectedCoin?.id,
    health?.kill_switch_active,
  ]);

  const handleGuardianAlert = useCallback(
    (msg: { reason: string; kill_switch_active: boolean }) => {
      toast.error(`Guardian alert: ${msg.reason}`, { duration: 8000 });
      refetchStatus();
      refetchGuardian();
    },
    [refetchStatus, refetchGuardian]
  );

  const handleKillSwitchChange = useCallback(() => {
    refetchStatus();
    refetchGuardian();
  }, [refetchStatus, refetchGuardian]);

  const handleOrderUpdate = useCallback(
    (msg: { status: string; symbol: string; side: string; fill_price: number | null }) => {
      if (msg.status === 'FILLED') {
        toast.success(
          `Order filled: ${msg.side} ${msg.symbol}${msg.fill_price ? ` @ ${msg.fill_price}` : ''}`
        );
        refetchStatus();
        refetchPortfolio();
        refetchEarnings();
      }
    },
    [refetchStatus, refetchPortfolio, refetchEarnings]
  );

  const { connected: wsConnected } = useBackendWebSocket({
    onGuardianAlert: handleGuardianAlert,
    onKillSwitchChange: handleKillSwitchChange,
    onOrderUpdate: handleOrderUpdate,
  });

  const handleSettingsChange = (newSettings: UserSettings) => {
    setSettings(newSettings);
    // Reset auto-trade guard so the new signal direction fires immediately.
    lastAutoTradeSig.current = null;
    toast.success('Settings updated successfully');
  };

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

  return (
    <div className="min-h-screen bg-background scanlines">
      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        backendConnected={isConnected}
        killSwitchActive={health?.kill_switch_active}
        paperBalance={paperBalance}
        systemMode={health?.mode ?? 'paper'}
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
          <div className="cyber-card p-4 border-warning bg-warning/10">
            <p className="text-warning font-mono text-sm">
              ⚠ Backend unavailable. Market state, health, and paper balance are offline.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          <div className="lg:col-span-8">
            <PriceChart price={selectedCoin} isLoading={isLoading} />
          </div>

          <div className="lg:col-span-4 space-y-4 lg:space-y-6">
            <SignalPanel signal={signal} isLoading={isLoading} />
            <RiskGauge risk={risk} isLoading={isLoading} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
          <MicrostructureDisplay features={microstructure} isLoading={isLoading} />
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
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
          <div className="lg:col-span-1">
            <EarningsPanel
              summary={earningsSummary}
              trades={earningsTrades}
              isLoading={earningsLoading}
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
                // PRICES: {priceSource === 'coingecko' ? 'COINGECKO LIVE' : 'BACKEND SYNTHETIC'}
              </span>
            )}
            {settings.autoTradeEnabled && (
              <span className="ml-2 text-accent opacity-80">// AUTO-TRADE ON</span>
            )}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent animate-pulse' : 'bg-muted-foreground'}`} />
              {wsConnected ? 'WS LIVE' : 'WS OFFLINE'}
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
      />
    </div>
  );
};

export default Index;
