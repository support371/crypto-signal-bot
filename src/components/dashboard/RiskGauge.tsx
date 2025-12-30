import { RiskAssessment } from '@/types/crypto';
import { ShieldCheck, ShieldAlert, ShieldX, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RiskGaugeProps {
  risk: RiskAssessment | null;
  isLoading?: boolean;
}

export function RiskGauge({ risk, isLoading }: RiskGaugeProps) {
  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="h-32 bg-muted rounded" />
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score <= 30) return 'text-accent';
    if (score <= 60) return 'text-warning';
    return 'text-destructive';
  };

  const getScoreGradient = (score: number) => {
    if (score <= 30) return 'from-accent/20 to-accent/5';
    if (score <= 60) return 'from-warning/20 to-warning/5';
    return 'from-destructive/20 to-destructive/5';
  };

  const getDecisionConfig = (decision: RiskAssessment['decision']) => {
    switch (decision) {
      case 'ENTER_LONG':
        return { icon: ShieldCheck, label: 'ENTER LONG', color: 'text-accent', bg: 'bg-accent/10' };
      case 'ENTER_SHORT':
        return { icon: ShieldAlert, label: 'ENTER SHORT', color: 'text-secondary', bg: 'bg-secondary/10' };
      case 'EXIT':
        return { icon: ShieldX, label: 'EXIT POSITION', color: 'text-destructive', bg: 'bg-destructive/10' };
      default:
        return { icon: AlertTriangle, label: 'HOLD', color: 'text-warning', bg: 'bg-warning/10' };
    }
  };

  const score = risk?.score ?? 50;
  const DecisionConfig = risk ? getDecisionConfig(risk.decision) : getDecisionConfig('HOLD');

  return (
    <div className="cyber-card p-6">
      <h3 className="font-display text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">
        Risk Engine
      </h3>
      
      <div className="space-y-6">
        {/* Risk Score Gauge */}
        <div className={cn(
          "relative rounded-xl p-6 bg-gradient-to-b",
          getScoreGradient(score)
        )}>
          <div className="text-center">
            <div className={cn(
              "font-display text-5xl font-black",
              getScoreColor(score)
            )}>
              {score}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Risk Score</div>
          </div>
          
          {/* Visual gauge bar */}
          <div className="mt-4 h-2 bg-muted/50 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full transition-all duration-500 rounded-full",
                score <= 30 ? "bg-accent" : score <= 60 ? "bg-warning" : "bg-destructive"
              )}
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>

        {/* Decision Output */}
        <div className={cn(
          "rounded-lg p-4 border",
          DecisionConfig.bg,
          risk?.approved ? "border-accent/30" : "border-destructive/30"
        )}>
          <div className="flex items-center gap-3">
            <DecisionConfig.icon className={cn("w-6 h-6", DecisionConfig.color)} />
            <div>
              <div className={cn("font-display font-bold", DecisionConfig.color)}>
                {DecisionConfig.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {risk?.approved ? '✓ Approved' : '✗ Not Approved'}
              </div>
            </div>
          </div>
        </div>

        {/* Position Size */}
        {risk && risk.positionSize > 0 && (
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Recommended Position</div>
            <div className="font-display font-semibold text-primary">
              {(risk.positionSize * 100).toFixed(0)}% of NAV
            </div>
          </div>
        )}

        {/* Reasoning */}
        {risk?.reasoning && (
          <div className="border-t border-border pt-4">
            <div className="text-xs text-muted-foreground mb-2">Analysis</div>
            <p className="text-sm font-mono leading-relaxed opacity-80">
              {risk.reasoning}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
