import { useState } from 'react';
import { useCryptoPrices } from '@/hooks/useCryptoPrices';
import { useSignalEngine } from '@/hooks/useSignalEngine';
import { Header } from '@/components/dashboard/Header';
import { PriceTicker } from '@/components/dashboard/PriceTicker';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { SignalPanel } from '@/components/dashboard/SignalPanel';
import { RiskGauge } from '@/components/dashboard/RiskGauge';
import { MicrostructureDisplay } from '@/components/dashboard/MicrostructureDisplay';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
import { SettingsModal, UserSettings, DEFAULT_SETTINGS } from '@/components/dashboard/SettingsModal';
import { toast } from 'sonner';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('bitcoin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  
  const { prices, isLoading, error } = useCryptoPrices();
  const selectedCoin = prices.find(p => p.id === selectedSymbol) || null;
  
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

  return (
    <div className="min-h-screen bg-background scanlines">
      <Header onSettingsClick={() => setSettingsOpen(true)} />
      
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
        
        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {/* Left Column - Chart */}
          <div className="lg:col-span-8">
            <PriceChart 
              price={selectedCoin} 
              isLoading={isLoading} 
            />
          </div>
          
          {/* Right Column - Signals & Risk */}
          <div className="lg:col-span-4 space-y-4 lg:space-y-6">
            <SignalPanel 
              signal={signal}
              isLoading={isLoading}
            />
            <RiskGauge 
              risk={risk}
              isLoading={isLoading}
            />
          </div>
        </div>
        
        {/* Bottom Grid - Microstructure & AI Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          <MicrostructureDisplay 
            features={microstructure}
            isLoading={isLoading}
          />
          <AIInsightCard 
            selectedCoin={selectedCoin}
            signal={signal?.direction}
            riskScore={risk?.score}
          />
        </div>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-border bg-muted/20 py-4 mt-8">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
          <span>LOVABLE AI RISK AGENT v1.0 // PAPER TRADING SIMULATOR</span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            SYSTEM OPERATIONAL
          </span>
        </div>
      </footer>

      {/* Settings Modal */}
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
