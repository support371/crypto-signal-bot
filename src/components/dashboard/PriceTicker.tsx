import { CryptoPrice } from '@/types/crypto';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PriceTickerProps {
  prices: CryptoPrice[];
  selectedSymbol: string;
  onSelect: (id: string) => void;
}

export function PriceTicker({ prices, selectedSymbol, onSelect }: PriceTickerProps) {
  return (
    <div className="w-full overflow-hidden bg-muted/30 border-b border-border">
      <div className="flex items-center gap-6 py-2 px-4 overflow-x-auto scrollbar-hide">
        {prices.map((coin) => {
          const isPositive = coin.change24h >= 0;
          const isSelected = coin.id === selectedSymbol;
          
          return (
            <button
              key={coin.id}
              onClick={() => onSelect(coin.id)}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-lg transition-all whitespace-nowrap",
                "hover:bg-muted/50 border border-transparent",
                isSelected && "border-primary bg-muted/50 shadow-neon-cyan"
              )}
            >
              <div className="flex flex-col items-start">
                <span className={cn(
                  "font-display text-sm font-semibold",
                  isSelected && "text-primary neon-glow"
                )}>
                  {coin.symbol}
                </span>
                <span className="text-xs text-muted-foreground">{coin.name}</span>
              </div>
              
              <div className="flex flex-col items-end">
                <span className="font-mono text-sm font-medium">
                  ${coin.price.toLocaleString(undefined, { 
                    minimumFractionDigits: 2,
                    maximumFractionDigits: coin.price < 1 ? 6 : 2
                  })}
                </span>
                <div className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  isPositive ? "text-accent status-bullish" : "text-destructive status-bearish"
                )}>
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : coin.change24h < 0 ? (
                    <TrendingDown className="w-3 h-3" />
                  ) : (
                    <Minus className="w-3 h-3" />
                  )}
                  <span>{isPositive ? '+' : ''}{coin.change24h.toFixed(2)}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
