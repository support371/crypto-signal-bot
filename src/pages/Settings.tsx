import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { useExchangeStatus } from '@/hooks/useExchangeStatus';
import { usePersistedSettings } from '@/hooks/usePersistedSettings';
import { DEFAULT_SETTINGS } from '@/components/dashboard/settingsDefaults';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  Settings as SettingsIcon,
  Shield,
  Activity,
  Wifi,
  Server,
  AlertTriangle,
  Volume2,
  Wallet,
  RefreshCw,
} from 'lucide-react';

interface ServerConfig {
  trading_mode: string;
  network: string;
  adapter: string;
  exchange: string;
  adapter_exchange: string;
  market_data_public_exchange: string;
  paper_use_live_market_data: boolean;
  config_path: string;
  cors_origins: string[];
  kill_switch_active: boolean;
  auth_enabled: boolean;
  rate_limit_rpm: number;
  risk_engine: {
    rules: string[];
    max_position_pct: number;
    max_daily_loss_pct: number;
    volatility_threshold: number;
    max_leverage: number;
    max_slippage_pct: number;
  };
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`}
    />
  );
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function getRiskLabel(value: number) {
  if (value <= 0.3) return 'Conservative';
  if (value <= 0.6) return 'Moderate';
  return 'Aggressive';
}

function getVolatilityLabel(value: number) {
  if (value <= 0.3) return 'Low';
  if (value <= 0.6) return 'Medium';
  return 'High';
}

export default function Settings() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { guardian } = useGuardianStatus();
  const { status: exchangeStatus } = useExchangeStatus();
  const { settings, setSettings } = usePersistedSettings();

  const fetchConfig = useCallback(async () => {
    try {
      const data = await fetchBackendJson<ServerConfig>('/config');
      setConfig(data);
      setConfigError(null);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return (
    <main className="min-h-screen bg-background scanlines">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-primary" />
              <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">
                Settings
              </h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Server configuration and dashboard preferences
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConfig}
            className="font-mono text-xs"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Refresh
          </Button>
        </div>

        <div className="cyber-card mb-6 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-accent" />
            <p className="font-mono text-xs text-muted-foreground">
              <span className="text-accent font-semibold">Paper Mode</span> — Server
              parameters are read-only and reflect the backend's active configuration.
              Dashboard preferences are stored locally in your browser.
            </p>
          </div>
        </div>

        {configError && (
          <div className="cyber-card mb-6 border-red-500/40 p-4">
            <p className="font-mono text-xs text-red-400">
              Config unavailable: {configError}
            </p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* System Status */}
          <section className="cyber-card p-5 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <Server className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                System Status
              </h2>
            </div>
            {loading ? (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            ) : config ? (
              <div className="space-y-0.5">
                <ConfigRow label="Trading Mode" value={config.trading_mode} />
                <ConfigRow label="Network" value={config.network} />
                <ConfigRow label="Exchange" value={config.exchange} />
                <ConfigRow label="Adapter" value={config.adapter} />
                <ConfigRow
                  label="Auth Enabled"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={config.auth_enabled} />
                      {config.auth_enabled ? 'Yes' : 'No'}
                    </span>
                  }
                />
                <ConfigRow label="Rate Limit" value={`${config.rate_limit_rpm} rpm`} />
                <ConfigRow label="Config Path" value={config.config_path || 'default'} />
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Unavailable</p>
            )}
          </section>

          {/* Risk Engine */}
          <section className="cyber-card p-5 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Risk Engine
              </h2>
            </div>
            {loading ? (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            ) : config?.risk_engine ? (
              <div className="space-y-0.5">
                <ConfigRow
                  label="Max Position"
                  value={`${(config.risk_engine.max_position_pct * 100).toFixed(1)}%`}
                />
                <ConfigRow
                  label="Max Daily Loss"
                  value={`${(config.risk_engine.max_daily_loss_pct * 100).toFixed(1)}%`}
                />
                <ConfigRow
                  label="Volatility Threshold"
                  value={config.risk_engine.volatility_threshold}
                />
                <ConfigRow
                  label="Max Leverage"
                  value={`${config.risk_engine.max_leverage}x`}
                />
                <ConfigRow
                  label="Max Slippage"
                  value={`${(config.risk_engine.max_slippage_pct * 100).toFixed(2)}%`}
                />
                <Separator className="my-2 bg-border" />
                <div>
                  <span className="text-xs text-muted-foreground">Active Rules</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {config.risk_engine.rules.map((rule) => (
                      <span
                        key={rule}
                        className="rounded border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[10px] text-primary"
                      >
                        {rule}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Unavailable</p>
            )}
          </section>

          {/* Guardian Status */}
          <section className="cyber-card p-5 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-accent" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Guardian Status
              </h2>
            </div>
            {guardian ? (
              <div className="space-y-0.5">
                <ConfigRow
                  label="Kill Switch"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={!guardian.kill_switch_active} />
                      {guardian.kill_switch_active ? 'ACTIVE' : 'Inactive'}
                    </span>
                  }
                />
                <ConfigRow
                  label="Guardian Triggered"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={!guardian.triggered} />
                      {guardian.triggered ? 'Yes' : 'No'}
                    </span>
                  }
                />
                <ConfigRow
                  label="API Errors"
                  value={guardian.api_error_count ?? 0}
                />
                <ConfigRow
                  label="Failed Orders"
                  value={guardian.failed_order_count ?? 0}
                />
                {guardian.kill_switch_reason && (
                  <ConfigRow label="Reason" value={guardian.kill_switch_reason} />
                )}
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            )}
          </section>

          {/* Market Data */}
          <section className="cyber-card p-5 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="h-4 w-4 text-green-400" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Market Data
              </h2>
            </div>
            {exchangeStatus ? (
              <div className="space-y-0.5">
                <ConfigRow
                  label="Connection"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={exchangeStatus.connected} />
                      {exchangeStatus.connection_state}
                    </span>
                  }
                />
                <ConfigRow label="Source" value={exchangeStatus.source} />
                <ConfigRow label="Mode" value={exchangeStatus.market_data_mode} />
                <ConfigRow
                  label="Live Data in Paper"
                  value={exchangeStatus.paper_use_live_market_data ? 'Yes' : 'No'}
                />
                <ConfigRow
                  label="Stale"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={!exchangeStatus.stale} />
                      {exchangeStatus.stale ? 'Yes' : 'No'}
                    </span>
                  }
                />
                <ConfigRow
                  label="Symbols"
                  value={exchangeStatus.symbols.join(', ')}
                />
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            )}
          </section>
        </div>

        {/* Dashboard Preferences */}
        <section className="cyber-card mt-6 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Dashboard Preferences
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="font-mono text-xs"
            >
              Reset Defaults
            </Button>
          </div>

          <p className="mb-5 text-xs text-muted-foreground">
            These preferences are stored in your browser and control paper-mode dashboard behavior.
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              {/* Risk Tolerance */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <Label className="text-xs font-semibold">Risk Tolerance</Label>
                </div>
                <div className="space-y-1.5 pl-5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Conservative</span>
                    <span className="font-mono text-primary">
                      {getRiskLabel(settings.riskTolerance)} ({(settings.riskTolerance * 100).toFixed(0)}%)
                    </span>
                    <span>Aggressive</span>
                  </div>
                  <Slider
                    value={[settings.riskTolerance]}
                    onValueChange={([v]) => setSettings({ ...settings, riskTolerance: v })}
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Volatility Sensitivity */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-secondary" />
                  <Label className="text-xs font-semibold">Volatility Sensitivity</Label>
                </div>
                <div className="space-y-1.5 pl-5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Ignore Spikes</span>
                    <span className="font-mono text-secondary">
                      {getVolatilityLabel(settings.volatilitySensitivity)} ({(settings.volatilitySensitivity * 100).toFixed(0)}%)
                    </span>
                    <span>React Strongly</span>
                  </div>
                  <Slider
                    value={[settings.volatilitySensitivity]}
                    onValueChange={([v]) => setSettings({ ...settings, volatilitySensitivity: v })}
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {/* Position Size */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Wallet className="h-3.5 w-3.5 text-accent" />
                  <Label className="text-xs font-semibold">Position Size</Label>
                </div>
                <div className="space-y-1.5 pl-5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>1%</span>
                    <span className="font-mono text-accent">
                      {(settings.positionSizeFraction * 100).toFixed(0)}% of NAV
                    </span>
                    <span>25%</span>
                  </div>
                  <Slider
                    value={[settings.positionSizeFraction]}
                    onValueChange={([v]) => setSettings({ ...settings, positionSizeFraction: v })}
                    min={0.01}
                    max={0.25}
                    step={0.01}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Spread Stress Threshold */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                  <Label className="text-xs font-semibold">Spread Stress Threshold</Label>
                </div>
                <div className="space-y-1.5 pl-5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0.1%</span>
                    <span className="font-mono text-yellow-400">
                      {(settings.spreadStressThreshold * 100).toFixed(2)}%
                    </span>
                    <span>0.5%</span>
                  </div>
                  <Slider
                    value={[settings.spreadStressThreshold]}
                    onValueChange={([v]) => setSettings({ ...settings, spreadStressThreshold: v })}
                    min={0.001}
                    max={0.005}
                    step={0.0005}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator className="my-5 bg-border" />

          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
            <div className="flex items-center justify-between sm:gap-3">
              <div className="flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-xs">Sound Alerts</Label>
              </div>
              <Switch
                checked={settings.soundAlertsEnabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, soundAlertsEnabled: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between sm:gap-3">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <div>
                  <Label className="text-xs">Auto-Trade (Paper)</Label>
                </div>
              </div>
              <Switch
                checked={settings.autoTradeEnabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, autoTradeEnabled: checked })
                }
              />
            </div>
          </div>
        </section>

        {/* Credential Boundary */}
        <section className="cyber-card mt-6 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">Credential Boundary</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground pl-6">
            Authentication uses your current application session. BACKEND_API_KEY remains
            server-only and is never requested, displayed, or persisted by this dashboard.
            Exchange API credentials are managed server-side.
          </p>
        </section>
      </div>
    </main>
  );
}
