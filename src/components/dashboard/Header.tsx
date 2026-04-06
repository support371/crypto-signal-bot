import { Activity, LogOut, Settings, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_CONFIGURED } from '@/integrations/supabase/config';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface HeaderProps {
  onSettingsClick?: () => void;
  backendConnected?: boolean;
  killSwitchActive?: boolean;
  paperBalance?: number | null;
  systemMode?: string;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export function Header({
  onSettingsClick,
  backendConnected = false,
  killSwitchActive = false,
  paperBalance,
  systemMode = 'paper',
}: HeaderProps) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out successfully');
    navigate('/auth');
  };

  const statusLabel = !backendConnected
    ? 'OFFLINE'
    : killSwitchActive
    ? 'HALTED'
    : systemMode.toUpperCase();

  const statusDotClass = !backendConnected
    ? 'bg-muted-foreground'
    : killSwitchActive
    ? 'bg-destructive'
    : 'bg-accent';

  const paperBalanceLabel =
    typeof paperBalance === 'number'
      ? currencyFormatter.format(paperBalance)
      : 'Unavailable';

  const subtitle = !backendConnected
    ? 'Control Center Offline'
    : systemMode === 'live'
    ? 'Execution Control Center'
    : 'Paper Trading Control Center';

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
                <Activity className="w-6 h-6 text-primary" />
              </div>
              <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${statusDotClass} ${backendConnected && !killSwitchActive ? 'animate-pulse-glow' : ''}`} />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-gradient-cyber">
                RISK AGENT
              </h1>
              <p className="text-xs text-muted-foreground">
                {subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
              <div className={`w-2 h-2 rounded-full ${statusDotClass} ${backendConnected && !killSwitchActive ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-mono text-muted-foreground">{statusLabel}</span>
            </div>

            <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/30 border border-border">
              <Wallet className="w-4 h-4 text-primary" />
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Paper Balance</div>
                <div className="font-mono font-semibold text-sm">{paperBalanceLabel}</div>
              </div>
            </div>

            {user && (
              <div className="hidden lg:block text-xs text-muted-foreground font-mono">
                {user.email}
              </div>
            )}

            <Button
              variant="outline"
              size="icon"
              onClick={onSettingsClick}
              className="border-border hover:border-primary hover:bg-primary/10"
            >
              <Settings className="w-4 h-4" />
            </Button>

            {SUPABASE_CONFIGURED && (
              <Button
                variant="outline"
                size="icon"
                onClick={handleSignOut}
                className="border-border hover:border-destructive hover:bg-destructive/10"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
