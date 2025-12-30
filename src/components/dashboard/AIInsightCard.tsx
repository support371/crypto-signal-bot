import { useEffect } from 'react';
import { useAIInsights } from '@/hooks/useAIInsights';
import { CryptoPrice } from '@/types/crypto';
import { Brain, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AIInsightCardProps {
  selectedCoin: CryptoPrice | null;
  signal?: string;
  riskScore?: number;
}

export function AIInsightCard({ selectedCoin, signal, riskScore }: AIInsightCardProps) {
  const { insight, isLoading, generateInsight } = useAIInsights();

  useEffect(() => {
    // Generate insight when coin changes
    if (selectedCoin) {
      generateInsight(selectedCoin, signal, riskScore);
    }
  }, [selectedCoin?.id]);

  const handleRefresh = () => {
    generateInsight(selectedCoin ?? undefined, signal, riskScore);
  };

  return (
    <div className="cyber-card p-6 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 via-transparent to-primary/5 pointer-events-none" />
      
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-secondary/20">
              <Brain className="w-5 h-5 text-secondary" />
            </div>
            <h3 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              AI Market Insight
            </h3>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-8 w-8"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-2/3" />
          </div>
        ) : insight ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-secondary mt-1 flex-shrink-0" />
              <p className="text-sm leading-relaxed text-foreground/90">
                {insight}
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">Select a coin to get AI-powered insights</p>
          </div>
        )}

        {selectedCoin && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-1 rounded bg-muted/50 font-mono">
                {selectedCoin.symbol}
              </span>
              <span>•</span>
              <span>Powered by Gemini AI</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
