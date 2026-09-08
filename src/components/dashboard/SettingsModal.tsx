import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Settings, Shield, Activity, Wallet, Volume2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@/components/dashboard/settingsDefaults';

export interface UserSettings {
  riskTolerance: number;
  volatilitySensitivity: number;
  positionSizeFraction: number;
  spreadStressThreshold: number;
  autoTradeEnabled: boolean;
  soundAlertsEnabled: boolean;
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: UserSettings;
  onSettingsChange: (settings: UserSettings) => void;
  systemMode?: string;
}

export function SettingsModal({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  systemMode = 'paper',
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<UserSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    onSettingsChange(localSettings);
    onOpenChange(false);
  };

  const handleReset = () => {
    setLocalSettings(DEFAULT_SETTINGS);
  };

  const getRiskLabel = (value: number) => {
    if (value <= 0.3) return 'Conservative';
    if (value <= 0.6) return 'Moderate';
    return 'Aggressive';
  };

  const getVolatilityLabel = (value: number) => {
    if (value <= 0.3) return 'Low';
    if (value <= 0.6) return 'Medium';
    return 'High';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Settings className="w-5 h-5 text-primary" />
            Risk Agent Settings
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Configure certification-mode risk and portfolio preferences. Authentication and privileged access are managed through your signed-in account and server-side RBAC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <Label className="text-sm font-semibold">Risk Tolerance</Label>
            </div>
            <div className="space-y-2 pl-6">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Conservative</span>
                <span className="font-mono text-primary">
                  {getRiskLabel(localSettings.riskTolerance)} ({(localSettings.riskTolerance * 100).toFixed(0)}%)
                </span>
                <span>Aggressive</span>
              </div>
              <Slider
                value={[localSettings.riskTolerance]}
                onValueChange={([value]) =>
                  setLocalSettings(s => ({ ...s, riskTolerance: value }))
                }
                min={0.1}
                max={0.9}
                step={0.05}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Higher values allow rehearsals with greater modeled risk scores.
              </p>
            </div>
          </div>

          <Separator className="bg-border" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-secondary" />
              <Label className="text-sm font-semibold">Volatility Sensitivity</Label>
            </div>
            <div className="space-y-2 pl-6">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Ignore Spikes</span>
                <span className="font-mono text-secondary">
                  {getVolatilityLabel(localSettings.volatilitySensitivity)} ({(localSettings.volatilitySensitivity * 100).toFixed(0)}%)
                </span>
                <span>React Strongly</span>
              </div>
              <Slider
                value={[localSettings.volatilitySensitivity]}
                onValueChange={([value]) =>
                  setLocalSettings(s => ({ ...s, volatilitySensitivity: value }))
                }
                min={0.1}
                max={0.9}
                step={0.05}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                How much volatility spikes affect risk calculations.
              </p>
            </div>
          </div>

          <Separator className="bg-border" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-accent" />
              <Label className="text-sm font-semibold">Position Size</Label>
            </div>
            <div className="space-y-2 pl-6">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1%</span>
                <span className="font-mono text-accent">
                  {(localSettings.positionSizeFraction * 100).toFixed(0)}% of NAV
                </span>
                <span>25%</span>
              </div>
              <Slider
                value={[localSettings.positionSizeFraction]}
                onValueChange={([value]) =>
                  setLocalSettings(s => ({ ...s, positionSizeFraction: value }))
                }
                min={0.01}
                max={0.25}
                step={0.01}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Maximum certification position size as a percentage of portfolio.
              </p>
            </div>
          </div>

          <Separator className="bg-border" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-warning" />
              <Label className="text-sm font-semibold">Spread Stress Threshold</Label>
            </div>
            <div className="space-y-2 pl-6">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0.1%</span>
                <span className="font-mono text-warning">
                  {(localSettings.spreadStressThreshold * 100).toFixed(2)}%
                </span>
                <span>0.5%</span>
              </div>
              <Slider
                value={[localSettings.spreadStressThreshold]}
                onValueChange={([value]) =>
                  setLocalSettings(s => ({ ...s, spreadStressThreshold: value }))
                }
                min={0.001}
                max={0.005}
                step={0.0005}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Spread percentage above which stress is flagged.
              </p>
            </div>
          </div>

          <Separator className="bg-border" />

          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Secure access</p>
              <p className="mt-1">
                No backend operator key is stored in this browser. Protected Worker actions use your authenticated Supabase session and server-authoritative RBAC; server secrets remain in Cloudflare/Vercel only.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm">Sound Alerts</Label>
              </div>
              <Switch
                checked={localSettings.soundAlertsEnabled}
                onCheckedChange={(checked) =>
                  setLocalSettings(s => ({ ...s, soundAlertsEnabled: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <div>
                  <Label className="text-sm">Auto-Trade Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Paper/certification rehearsal only; current backend mode is {systemMode}.
                  </p>
                </div>
              </div>
              <Switch
                checked={localSettings.autoTradeEnabled}
                onCheckedChange={(checked) =>
                  setLocalSettings(s => ({ ...s, autoTradeEnabled: checked }))
                }
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-4 border-t border-border">
          <Button variant="ghost" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-primary text-primary-foreground">
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
