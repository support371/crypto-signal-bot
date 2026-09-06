import { Activity, LogOut, Settings, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, isSupabaseConfigured as SUPABASE_CONFIGURED } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface HeaderProps {
  onSettingsClick?: () => void;
  backendConnected?: boolean;
  killSwitchActive?: boolean;
  certificationBalance?: number | null;
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
  certificationBalance,
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
    </header>
  );
}