import { Activity, Settings, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  onSettingsClick?: () => void;
}

export function Header({ onSettingsClick }: HeaderProps) {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
                <Activity className="w-6 h-6 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full animate-pulse-glow" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-gradient-cyber">
                RISK AGENT
              </h1>
              <p className="text-xs text-muted-foreground">
                Paper Trading Simulator
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Status indicator */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-xs font-mono text-muted-foreground">LIVE</span>
            </div>

            {/* Paper balance */}
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/30 border border-border">
              <Wallet className="w-4 h-4 text-primary" />
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Paper Balance</div>
                <div className="font-mono font-semibold text-sm">$10,000.00</div>
              </div>
            </div>

            {/* Settings */}
            <Button
              variant="outline"
              size="icon"
              onClick={onSettingsClick}
              className="border-border hover:border-primary hover:bg-primary/10"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
