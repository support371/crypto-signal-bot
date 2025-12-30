import { Signal } from '@/types/crypto';
import { ArrowUp, ArrowDown, Circle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

interface SignalPanelProps {
  signal: Signal | null;
  isLoading?: boolean;
}

export function SignalPanel({ signal, isLoading }: SignalPanelProps) {
  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="h-24 bg-muted rounded" />
      </div>
    );
  }

  const getDirectionConfig = () => {
    if (!signal) return { icon: Circle, label: 'ANALYZING', color: 'text-muted-foreground' };
    
    switch (signal.direction) {
      case 'UP':
        return { icon: ArrowUp, label: 'BULLISH', color: 'text-accent status-bullish' };
      case 'DOWN':
        return { icon: ArrowDown, label: 'BEARISH', color: 'text-destructive status-bearish' };
      default:
        return { icon: Circle, label: 'NEUTRAL', color: 'text-muted-foreground' };
    }
  };

  const getRegimeColor = () => {
    if (!signal) return 'text-muted-foreground';
    switch (signal.regime) {
      case 'TREND': return 'text-accent';
      case 'CHAOS': return 'text-destructive';
      default: return 'text-warning';
    }
  };

  const { icon: DirectionIcon, label, color } = getDirectionConfig();

  return (
    <div className="cyber-card p-6">
      <h3 className="font-display text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">
        Signal Analysis
      </h3>
      
      <div className="space-y-6">
        {/* Direction Indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-3 rounded-lg bg-muted/50", color)}>
              <DirectionIcon className="w-8 h-8" />
            </div>
            <div>
              <span className={cn("font-display text-2xl font-bold", color)}>
                {label}
              </span>
              <div className="text-xs text-muted-foreground">Direction Signal</div>
            </div>
          </div>
        </div>

        {/* Confidence Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Confidence</span>
            <span className={cn(
              "font-mono font-semibold",
              signal && signal.confidence > 70 ? "text-accent" : 
              signal && signal.confidence > 40 ? "text-warning" : "text-muted-foreground"
            )}>
              {signal?.confidence ?? 0}%
            </span>
          </div>
          <Progress 
            value={signal?.confidence ?? 0} 
            className="h-2 bg-muted"
          />
        </div>

        {/* Regime & Horizon */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Market Regime</div>
            <div className={cn("font-display font-semibold", getRegimeColor())}>
              {signal?.regime ?? 'N/A'}
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Horizon
            </div>
            <div className="font-display font-semibold text-foreground">
              {signal?.horizon ?? 0}m
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
