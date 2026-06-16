import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { CryptoPrice } from '@/types/crypto';
import { fetchBackendJson } from '@/lib/backend';

interface CoinConfig {
  id: string;
  symbol: string;
  name: string;
  backendSymbol: string;
}

const DEFAULT_COINS: CoinConfig[] = [
  { id: 'bitcoin',      symbol: 'BTC',  name: 'Bitcoin',   backendSymbol: 'BTCUSDT'  },
  { id: 'ethereum',     symbol: 'ETH',  name: 'Ethereum',  backendSymbol: 'ETHUSDT'  },
  { id: 'solana',       symbol: 'SOL',  name: 'Solana',    backendSymbol: 'SOLUSDT'  },
  { id: 'binancecoin',  symbol: 'BNB',  name: 'BNB',       backendSymbol: 'BNBUSDT'  },
  { id: 'cardano',      symbol: 'ADA',  name: 'Cardano',   backendSymbol: 'ADAUSDT'  },
  { id: 'ripple',       symbol: 'XRP',  name: 'XRP',       backendSymbol: 'XRPUSDT'  },
  { id: 'polkadot',     symbol: 'DOT',  name: 'Polkadot',  backendSymbol: 'DOTUSDT'  },
  { id: 'avalanche-2',  symbol: 'AVAX', name: 'Avalanche', backendSymbol: 'AVAXUSDT' },
  { id: 'dogecoin',     symbol: 'DOGE', name: 'Dogecoin',  backendSymbol: 'DOGEUSDT' },
  { id: 'chainlink',    symbol: 'LINK', name: 'Chainlink', backendSymbol: 'LINKUSDT' },
];

const COIN_LOOKUP = new Map(DEFAULT_COINS.map((coin) => [coin.id, coin]));
const COIN_BY_SYMBOL = new Map(DEFAULT_COINS.map((coin) => [coin.symbol, coin]));

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

interface CoinGeckoResponse {
  [id: string]: {
    usd: number;
    usd_24h_change?: number;
    usd_24h_vol?: number;
    usd_market_cap?: number;
  };
}

interface BatchPriceItem {
  id?: string;
  symbol?: string;
  name?: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
  lastUpdated?: string;
  stale?: boolean;
  ts?: number;
  timestamp?: number;
}

interface BatchPricesResponse {
  prices?: BatchPriceItem[];
  source?: string;
  as_of?: number;
  cached?: boolean;
}

function normalizeSymbol(symbol: unknown): string {
  return String(symbol ?? '')
    .toUpperCase()
    .replace(/[-/](USDT|USD)$/i, '')
    .replace(/(USDT|USD)$/i, '')
    .trim();
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveCoin(item: BatchPriceItem): CoinConfig | null {
  const symbol = normalizeSymbol(item.symbol);
  if (symbol && COIN_BY_SYMBOL.has(symbol)) return COIN_BY_SYMBOL.get(symbol) ?? null;
  if (item.id && COIN_LOOKUP.has(item.id)) return COIN_LOOKUP.get(item.id) ?? null;
  return null;
}

function isoFromItem(item: BatchPriceItem): string {
  const rawTs = item.timestamp ?? item.ts;
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    return new Date(rawTs > 10_000_000_000 ? rawTs : rawTs * 1000).toISOString();
  }
  return item.lastUpdated ?? new Date().toISOString();
}

async function fetchFromCoinGecko(coins: CoinConfig[]): Promise<CryptoPrice[]> {
  const ids = coins.map((c) => c.id).join(',');
  const url = `${COINGECKO_API}?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data: CoinGeckoResponse = await res.json();
  const now = new Date().toISOString();
  return coins.map((coin) => {
    const d: CoinGeckoResponse[string] = data[coin.id] ?? { usd: 0 };
    return {
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: d.usd ?? 0,
      change24h: Number((d.usd_24h_change ?? 0).toFixed(2)),
      volume24h: d.usd_24h_vol ?? 0,
      marketCap: d.usd_market_cap ?? 0,
      lastUpdated: now,
    } satisfies CryptoPrice;
  });
}

async function fetchFromBackend(
  coins: CoinConfig[],
  sessionBaselineRef: MutableRefObject<Map<string, number>>,
): Promise<CryptoPrice[]> {
  if (coins.length === 0) return [];

  const symbols = coins.map((c) => c.backendSymbol).join(',');
  const response = await fetchBackendJson<BatchPricesResponse>(
    `/prices/batch?symbols=${encodeURIComponent(symbols)}`,
  );

  const items = Array.isArray(response.prices) ? response.prices : [];
  if (items.length === 0) throw new Error('Backend returned no prices');

  return coins.map((coin) => {
    const item = items.find((candidate) => {
      const resolved = resolveCoin(candidate);
      return resolved?.id === coin.id;
    });
    const price = numberOr(item?.price);
    if (!sessionBaselineRef.current.has(coin.id)) {
      sessionBaselineRef.current.set(coin.id, price);
    }
    const baseline = sessionBaselineRef.current.get(coin.id) || price;
    const sessionChangePct = baseline === 0 ? 0 : ((price - baseline) / baseline) * 100;
    const change24h = typeof item?.change24h === 'number' && Number.isFinite(item.change24h)
      ? item.change24h
      : sessionChangePct;

    return {
      id: item?.id ?? coin.id,
      symbol: normalizeSymbol(item?.symbol) || coin.symbol,
      name: item?.name ?? coin.name,
      price,
      change24h: Number(change24h.toFixed(2)),
      volume24h: numberOr(item?.volume24h),
      marketCap: numberOr(item?.marketCap),
      lastUpdated: item ? isoFromItem(item) : new Date().toISOString(),
    } satisfies CryptoPrice;
  });
}

export function useCryptoPrices(symbols?: string[], preferBackend = false) {
  const sessionBaselineRef = useRef<Map<string, number>>(new Map());

  const requestedCoins = useMemo(() => {
    if (!symbols?.length) return DEFAULT_COINS;
    return symbols.map((id) => COIN_LOOKUP.get(id)).filter((c): c is CoinConfig => Boolean(c));
  }, [symbols]);

  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [source, setSource] = useState<'coingecko' | 'backend' | 'backend-live' | null>(null);

  const fetchPrices = useCallback(async () => {
    if (requestedCoins.length === 0) {
      setPrices([]);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      if (preferBackend) {
        try {
          const livePaper = await fetchFromBackend(requestedCoins, sessionBaselineRef);
          setPrices(livePaper);
          setSource('backend-live');
        } catch {
          const live = await fetchFromCoinGecko(requestedCoins);
          setPrices(live);
          setSource('coingecko');
        }
      } else {
        try {
          const live = await fetchFromCoinGecko(requestedCoins);
          setPrices(live);
          setSource('coingecko');
        } catch {
          const synthetic = await fetchFromBackend(requestedCoins, sessionBaselineRef);
          setPrices(synthetic);
          setSource('backend');
        }
      }
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prices');
    } finally {
      setIsLoading(false);
    }
  }, [preferBackend, requestedCoins]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  return { prices, isLoading, error, lastUpdate, source, refetch: fetchPrices };
}
