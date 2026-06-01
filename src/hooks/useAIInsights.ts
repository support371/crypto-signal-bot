import { useState, useCallback } from 'react';
import { CryptoPrice } from '@/types/crypto';
import { toast } from 'sonner';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)
  ?? 'https://crypto-signal-bot-deqd.onrender.com';

interface SignalMetadata {
  indicators: {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi14: number;
    bb_upper: number;
    bb_mid: number;
    bb_lower: number;
    macd: number;
    macd_signal: number;
    macd_hist: number;
    atr14: number;
  };
  strategy_votes: Record<string, { side: string; confidence: number }>;
}

interface SignalResponse {
  symbol: string;
  side: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  confidence: number;
  strategy_id: string;
  metadata?: SignalMetadata;
}

function buildInsight(signal: SignalResponse, coin: CryptoPrice): string {
  const { side, confidence, entry_price, stop_loss, take_profit, metadata } = signal;
  const ind = metadata?.indicators;
  const votes = metadata?.strategy_votes ?? {};

  const pct = (confidence * 100).toFixed(0);
  const dirLabel = side === 'BUY' ? 'bullish' : side === 'SELL' ? 'bearish' : 'neutral';
  const change = coin.change24h >= 0
    ? `+${coin.change24h.toFixed(2)}%`
    : `${coin.change24h.toFixed(2)}%`;

  const lines: string[] = [];

  // Headline
  lines.push(
    `${coin.name} is showing a ${dirLabel} signal with ${pct}% confidence. ` +
    `Price is ${change} over 24h, currently at $${coin.price.toLocaleString()}.`
  );

  // Indicator commentary
  if (ind) {
    const rsiComment =
      ind.rsi14 > 70
        ? `RSI at ${ind.rsi14.toFixed(1)} is overbought — momentum may be fading.`
        : ind.rsi14 < 30
        ? `RSI at ${ind.rsi14.toFixed(1)} is oversold — a bounce could be near.`
        : `RSI is neutral at ${ind.rsi14.toFixed(1)}.`;

    const trendComment =
      ind.ema20 > ind.ema50
        ? `Short-term EMA (${ind.ema20.toFixed(0)}) is above mid-term EMA (${ind.ema50.toFixed(0)}), confirming upward pressure.`
        : `Short-term EMA (${ind.ema20.toFixed(0)}) is below mid-term EMA (${ind.ema50.toFixed(0)}), signalling downward pressure.`;

    const bbComment =
      coin.price >= ind.bb_upper
        ? `Price is touching the upper Bollinger Band — resistance near $${ind.bb_upper.toFixed(0)}.`
        : coin.price <= ind.bb_lower
        ? `Price is near the lower Bollinger Band — support near $${ind.bb_lower.toFixed(0)}.`
        : `Price sits within Bollinger Bands ($${ind.bb_lower.toFixed(0)}–$${ind.bb_upper.toFixed(0)}).`;

    const macdComment =
      ind.macd_hist > 0
        ? `MACD histogram is positive (${ind.macd_hist.toFixed(4)}), suggesting building bullish momentum.`
        : `MACD histogram is negative (${ind.macd_hist.toFixed(4)}), suggesting bearish momentum.`;

    lines.push(`${rsiComment} ${trendComment}`);
    lines.push(`${bbComment} ${macdComment}`);
  }

  // Strategy consensus
  const voteKeys = Object.keys(votes);
  if (voteKeys.length > 0) {
    const agreeing = voteKeys.filter(k => votes[k].side === side);
    const disagreeing = voteKeys.filter(
      k => votes[k].side !== side && votes[k].side !== 'FLAT'
    );
    if (agreeing.length === voteKeys.length) {
      lines.push(`All ${voteKeys.length} strategies agree on a ${dirLabel} bias.`);
    } else {
      lines.push(
        `${agreeing.length}/${voteKeys.length} strategies lean ${dirLabel}` +
        (disagreeing.length > 0
          ? ` — mixed signals from ${disagreeing.join(', ')}.`
          : '.')
      );
    }
  }

  // Risk / reward summary
  if (entry_price && stop_loss && take_profit) {
    const riskPct = Math.abs(((stop_loss - entry_price) / entry_price) * 100).toFixed(2);
    const rewardPct = Math.abs(((take_profit - entry_price) / entry_price) * 100).toFixed(2);
    lines.push(
      `Risk/Reward: stop at $${stop_loss.toFixed(0)} (−${riskPct}%), ` +
      `target $${take_profit.toFixed(0)} (+${rewardPct}%).`
    );
  }

  return lines.join(' ');
}

// Symbol ID → backend symbol mapping
const SYMBOL_MAP: Record<string, string> = {
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  binancecoin: 'BNBUSDT',
  cardano: 'ADAUSDT',
  ripple: 'XRPUSDT',
  dogecoin: 'DOGEUSDT',
  polkadot: 'DOTUSDT',
  'avalanche-2': 'AVAXUSDT',
  avalanche: 'AVAXUSDT',
  chainlink: 'LINKUSDT',
  btc: 'BTCUSDT',
  eth: 'ETHUSDT',
  sol: 'SOLUSDT',
  bnb: 'BNBUSDT',
  ada: 'ADAUSDT',
  xrp: 'XRPUSDT',
  doge: 'DOGEUSDT',
  dot: 'DOTUSDT',
  avax: 'AVAXUSDT',
  link: 'LINKUSDT',
};

export function useAIInsights() {
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const generateInsight = useCallback(async (
    priceData?: CryptoPrice,
    _signal?: string,
    _riskScore?: number
  ) => {
    if (!priceData) return;

    setIsLoading(true);
    try {
      const backendSymbol =
        SYMBOL_MAP[priceData.id.toLowerCase()] ??
        SYMBOL_MAP[priceData.symbol.toLowerCase()] ??
        `${priceData.symbol.toUpperCase()}USDT`;

      const res = await fetch(
        `${BACKEND_URL}/api/v1/signals/${backendSymbol}`,
        { signal: AbortSignal.timeout(8000) }
      );

      if (!res.ok) throw new Error(`Signal fetch failed: ${res.status}`);

      const signalData: SignalResponse = await res.json();
      setInsight(buildInsight(signalData, priceData));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AIInsight] error:', err);

      if (message.includes('timeout') || message.includes('fetch')) {
        toast.error('Signal backend unreachable — will retry');
      } else if (!message.includes('404')) {
        toast.error('Failed to generate AI insight');
      }
      setInsight(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Always available — no Supabase required
  return { insight, isLoading, generateInsight, available: true };
}
