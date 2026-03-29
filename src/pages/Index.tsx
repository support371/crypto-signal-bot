import { useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/dashboard/Header';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
import { MicrostructureDisplay } from '@/components/dashboard/MicrostructureDisplay';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { PriceTicker } from '@/components/dashboard/PriceTicker';
import { RiskGauge } from '@/components/dashboard/RiskGauge';
import { SettingsModal, UserSettings, DEFAULT_SETTINGS } from '@/components/dashboard/SettingsModal';
import { SignalPanel } from '@/components/dashboard/SignalPanel';
import { useBackendStatus } from '@/hooks/useBackendStatus';
import { useCryptoPrices } from '@/hooks/useCryptoPrices';
import { useSignalEngine } from '@/hooks/useSignalEngine';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('bitcoin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  const { prices, isLoading, error } = useCryptoPrices();
  const { health, paperBalance, isConnected } = useBackendStatus();
  const selectedCoin = prices.find((price) => price.id === selectedSymbol) || null;

  const { signal, risk, microstructure } = useSignalEngine(selectedCoin, {
    riskTolerance: settings.riskTolerance,
    spreadStressThreshold: settings.spreadStressThreshold,
    volatilitySensitivity: settings.volatilitySensitivity,
    positionSizeFraction: settings.positionSizeFraction,
  });

  const handleSettingsChange = (newSettings: UserSettings) => {
    setSettings(newSettings);
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          <MicrostructureDisplay features={microstructure} isLoading={isLoading} />
          <AIInsightCard
            selectedCoin={selectedCoin}
            signal={signal?.direction}
            riskScore={risk?.score}
          />
        </div>
      </main>

      <footer className="border-t border-border bg-muted/20 py-4 mt-8">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
          <span>LOVABLE AI RISK AGENT v1.1 // BACKEND-OWNED MARKET STATE</span>
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${footerDotClass} ${isConnected && !health?.kill_switch_active ? 'animate-pulse' : ''}`} />
            {footerLabel}
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
