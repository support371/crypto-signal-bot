import { useState, useCallback } from 'react';
import { CryptoPrice } from '@/types/crypto';
import { toast } from 'sonner';
import { getConfiguredBackendUrl } from '@/lib/env';
import { readOperatorApiKey } from '@/lib/operatorAuth';

const BACKEND_URL = getConfiguredBackendUrl();

interface SignalMetadata {
  indicators: {
    ema20: number; ema50: number; ema200: number;
    rsi14: number;
    bb_upper: number; bb_mid: number; bb_lower: number;
    macd: number; macd_signal: number; macd_hist: number;
    atr14: number;
  };
  strategy_votes: Record<string, { side: string; confidence: number }>;
}

interface SignalResponse {
  symbol: string; side: string;
  entry_price: number; stop_loss: number; take_profit: number;
  confidence: number; strategy_id: string;
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

  lines.push(
    `${coin.name} is showing a ${dirLabel} signal with ${pct}% confidence. ` +
    `Price is ${change} over 24h, currently at $${coin.price.toLocaleString()}.`
  );

  if (ind) {
    const rsiComment =
      ind.rsi14 > 70 ? `RSI at ${ind.rsi14.toFixed(1)} is overbought — momentum may be fading.`
      : ind.rsi14 < 30 ? `RSI at ${ind.rsi14.toFixed(1)} is oversold — a bounce could be near.`
      : `RSI is neutral at ${ind.rsi14.toFixed(1)}.`;

    const trendComment =
      ind.ema20 > ind.ema50
        ? `Short-term EMA (${ind.ema20.toFixed(0)}) is above mid-term EMA (${ind.ema50.toFixed(0)}), confirming upward pressure.`
        : `Short-term EMA (${ind.ema20.toFixed(0)}) is below mid-term EMA (${ind.ema50.toFixed(0)}), signalling downward pressure.`;

    const bbComment =
      coin.price >= ind.bb_upper
        ? `Price is touching the upper Bollinger Band — resistance near $${ind.bb_upper.toFixed(2)}.`
        : coin.price <= ind.bb_lower
        ? `Price near the lower Bollinger Band — support near $${ind.bb_lower.toFixed(2)}.`
        : `Price within Bollinger Bands ($${ind.bb_lower.toFixed(2)}–$${ind.bb_upper.toFixed(2)}).`;

    const macdComment =
      ind.macd_hist > 0
        ? `MACD histogram positive (${ind.macd_hist.toFixed(4)}) — building bullish momentum.`
        : `MACD histogram negative (${ind.macd_hist.toFixed(4)}) — bearish momentum.`;

    lines.push(`${rsiComment} ${trendComment}`);
    lines.push(`${bbComment} ${macdComment}`);
  }

  const voteKeys = Object.keys(votes);
  if (voteKeys.length > 0) {
    const agreeing = voteKeys.filter(k => votes[k].side === side);
    const disagreeing = voteKeys.filter(k => votes[k].side !== side && votes[k].side !== 'FLAT');
    if (agreeing.length === voteKeys.length) {
      lines.push(`All ${voteKeys.length} strategies agree on a ${dirLabel} bias.`);
    } else {
      lines.push(
        `${agreeing.length}/${voteKeys.length} strategies lean ${dirLabel}` +
        (disagreeing.length > 0 ? ` — mixed signals from ${disagreeing.join(', ')}.` : '.')
      );
    }
  }

  if (entry_price && stop_loss && take_profit) {
    const riskPct = Math.abs(((stop_loss - entry_price) / entry_price) * 100).toFixed(2);
    const rewardPct = Math.abs(((take_profit - entry_price) / entry_price) * 100).toFixed(2);
    lines.push(
      `Risk/Reward: stop $${stop_loss.toFixed(2)} (−${riskPct}%), target $${take_profit.toFixed(2)} (+${rewardPct}%).`
    );
  }

  return lines.join(' ');
}

const SYMBOL_MAP: Record<string, string> = {
  bitcoin: 'BTCUSDT',      btc: 'BTCUSDT',
  ethereum: 'ETHUSDT',     eth: 'ETHUSDT',
  solana: 'SOLUSDT',       sol: 'SOLUSDT',
  binancecoin: 'BNBUSDT',  bnb: 'BNBUSDT',
  cardano: 'ADAUSDT',      ada: 'ADAUSDT',
  ripple: 'XRPUSDT',       xrp: 'XRPUSDT',
  dogecoin: 'DOGEUSDT',    doge: 'DOGEUSDT',
  polkadot: 'DOTUSDT',     dot: 'DOTUSDT',
  'avalanche-2': 'AVAXUSDT', avalanche: 'AVAXUSDT', avax: 'AVAXUSDT',
  chainlink: 'LINKUSDT',   link: 'LINKUSDT',
};

async function fetchWithRetry(url: string, retries = 2, timeoutMs = 12000): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const apiKey = readOperatorApiKey();
      const headers: HeadersInit = apiKey ? { 'X-API-Key': apiKey } : {};
      const res = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === retries) throw err;
      // Exponential backoff: 1s, 2s
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('All retries exhausted');
}

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

      const res = await fetchWithRetry(
        `${BACKEND_URL}/api/v1/signals/${backendSymbol}`,
        2,   // up to 2 retries (3 attempts total)
        12000 // 12s timeout per attempt — handles Render cold starts
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const signalData: SignalResponse = await res.json();
      setInsight(buildInsight(signalData, priceData));
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : '';
      console.error('[AIInsight] error:', err);

      if (name === 'AbortError') {
        toast.error('Signal backend is waking up — try again in a few seconds');
      } else if (message.includes('fetch') || message.includes('network') || message.includes('Failed to fetch')) {
        toast.error('Could not reach signal backend');
      } else if (!message.includes('404')) {
        toast.error('Failed to generate AI insight');
      }
      setInsight(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { insight, isLoading, generateInsight, available: true };
}
