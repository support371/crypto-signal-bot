import { MicrostructureFeatures } from '@/types/crypto';
import { cn } from '@/lib/utils';
import { Activity, BarChart2, Zap, Layers } from 'lucide-react';

interface MicrostructureDisplayProps {
  features: MicrostructureFeatures | null;
  isLoading?: boolean;
}

export function MicrostructureDisplay({ features, isLoading }: MicrostructureDisplayProps) {
  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded mb-4" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  const metrics = [
    {
      label: 'Spread',
      value: features?.spreadPercentage ? `${(features.spreadPercentage * 100).toFixed(3)}%` : 'N/A',
      icon: BarChart2,
      status: features?.spreadPercentage && features.spreadPercentage > 0.002 ? 'warning' : 'normal',
    },
    {
      label: 'Order Imbalance',
      value: features?.orderBookImbalance?.toFixed(2) ?? 'N/A',
      icon: Layers,
      status: features?.orderBookImbalance 
        ? features.orderBookImbalance > 0.3 ? 'bullish' 
        : features.orderBookImbalance < -0.3 ? 'bearish' 
        : 'normal'
        : 'normal',
    },
    {
      label: 'Mid-Price Velocity',
      value: features?.midPriceVelocity ? `${features.midPriceVelocity.toFixed(2)}%/h` : 'N/A',
      icon: Activity,
      status: features?.midPriceVelocity 
        ? features.midPriceVelocity > 0 ? 'bullish' : 'bearish'
        : 'normal',
    },
    {
      label: 'Volatility',
      value: features?.volatilitySpike ? 'SPIKE!' : 'Normal',
      icon: Zap,
      status: features?.volatilitySpike ? 'danger' : 'normal',
      pulse: features?.volatilitySpike,
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'bullish': return 'text-accent border-accent/30 bg-accent/5';
      case 'bearish': return 'text-destructive border-destructive/30 bg-destructive/5';
      case 'warning': return 'text-warning border-warning/30 bg-warning/5';
      case 'danger': return 'text-destructive border-destructive/50 bg-destructive/10';
      default: return 'text-foreground border-border bg-muted/30';
    }
  };

  return (
    <div className="cyber-card p-6">
      <h3 className="font-display text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">
        Microstructure Features
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        {metrics.map(({ label, value, icon: Icon, status, pulse }) => (
          <div 
            key={label}
            className={cn(
              "rounded-lg p-3 border transition-all",
              getStatusColor(status),
              pulse && "animate-pulse-glow"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 opacity-60" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <div className="font-mono font-semibold text-lg">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Depth Decay Bar */}
      {features && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-muted-foreground">Depth Decay</span>
            <span className="font-mono">{(features.depthDecay * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
              style={{ width: `${features.depthDecay * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
