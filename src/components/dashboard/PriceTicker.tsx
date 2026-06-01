import { CryptoPrice } from '@/types/crypto';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PriceTickerProps {
  prices: CryptoPrice[];
  selectedSymbol: string;
  onSelect: (id: string) => void;
}

function PriceTickerItem({
  coin,
  isSelected,
  onSelect,
}: {
  coin: CryptoPrice;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const isPositive = coin.change24h >= 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(coin.id)}
      className={cn(
        'flex shrink-0 items-center gap-3 rounded-lg border border-transparent px-4 py-2 whitespace-nowrap transition-all',
        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
        isSelected && 'border-primary bg-muted/50 shadow-neon-cyan'
      )}
    >
      <div className="flex flex-col items-start">
        <span className={cn('font-display text-sm font-semibold', isSelected && 'text-primary neon-glow')}>
          {coin.symbol}
        </span>
        <span className="text-xs text-muted-foreground">{coin.name}</span>
      </div>

      <div className="flex flex-col items-end">
        <span className="font-mono text-sm font-medium">
          ${coin.price.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: coin.price < 1 ? 6 : 2,
          })}
        </span>
        <div
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            isPositive ? 'text-accent status-bullish' : 'text-destructive status-bearish'
          )}
        >
          {isPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : coin.change24h < 0 ? (
            <TrendingDown className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          <span>{isPositive ? '+' : ''}{coin.change24h.toFixed(2)}%</span>
        </div>
      </div>
    </button>
  );
}

export function PriceTicker({ prices, selectedSymbol, onSelect }: PriceTickerProps) {
  const tickerPrices = prices.length > 0 ? prices : [];
  const scrollingPrices = [...tickerPrices, ...tickerPrices, ...tickerPrices];

  return (
    <div className="w-full border-b border-border bg-muted/30">
      {/* Desktop: scrolling marquee */}
      <div className="hidden sm:block overflow-hidden">
        <div className="ticker-marquee py-2" aria-label="Live crypto price ticker">
          <div className="ticker-marquee-track flex w-max items-center gap-6 px-4">
            {scrollingPrices.map((coin, index) => (
              <PriceTickerItem
                key={`${coin.id}-${index}`}
                coin={coin}
                isSelected={coin.id === selectedSymbol}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: static scrollable grid of coin buttons */}
      <div className="sm:hidden overflow-x-auto py-2 px-2">
        <div className="flex gap-2 w-max">
          {tickerPrices.map((coin) => {
            const isSelected = coin.id === selectedSymbol;
            const isPositive = coin.change24h >= 0;
            return (
              <button
                key={coin.id}
                type="button"
                onClick={() => onSelect(coin.id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-xs whitespace-nowrap transition-all min-w-[64px]',
                  isSelected
                    ? 'border-primary bg-muted/50 shadow-neon-cyan'
                    : 'border-border/40 bg-transparent hover:bg-muted/40'
                )}
              >
                <span className={cn('font-display font-bold text-sm', isSelected && 'text-primary neon-glow')}>
                  {coin.symbol}
                </span>
                <span className={cn('font-mono text-[10px]', isPositive ? 'text-accent' : 'text-destructive')}>
                  {isPositive ? '+' : ''}{coin.change24h.toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
