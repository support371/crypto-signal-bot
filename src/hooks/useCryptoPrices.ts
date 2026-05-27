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

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

interface CoinGeckoResponse {
  [id: string]: {
    usd: number;
    usd_24h_change?: number;
    usd_24h_vol?: number;
    usd_market_cap?: number;
  };
}

interface BackendPriceResponse {
  symbol: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
  timestamp?: number;
  source?: string;
  market_data_mode?: string;
}

async function fetchFromCoinGecko(coins: CoinConfig[]): Promise<CryptoPrice[]> {
  const ids = coins.map((c) => c.id).join(',');
  const url = `${COINGECKO_API}?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data: CoinGeckoResponse = await res.json();
  const now = new Date().toISOString();
  return coins.map((coin) => {
    const d = data[coin.id] ?? {};
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
  sessionBaselineRef: MutableRefObject<Map<string, number>>
): Promise<CryptoPrice[]> {
  return Promise.all(
    coins.map(async (coin) => {
      const data = await fetchBackendJson<BackendPriceResponse>(
        `/price?symbol=${encodeURIComponent(coin.backendSymbol)}`
      );
      if (!sessionBaselineRef.current.has(coin.id)) {
        sessionBaselineRef.current.set(coin.id, data.price);
      }
      const baseline = sessionBaselineRef.current.get(coin.id) || data.price;
      const sessionChangePct = baseline === 0 ? 0 : ((data.price - baseline) / baseline) * 100;
      const change24h =
        typeof data.change24h === 'number' && Number.isFinite(data.change24h)
          ? data.change24h
          : sessionChangePct;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        price: data.price,
        change24h: Number(change24h.toFixed(2)),
        volume24h: data.volume24h ?? 0,
        marketCap: data.marketCap ?? 0,
        lastUpdated: new Date((data.timestamp || Date.now() / 1000) * 1000).toISOString(),
      } satisfies CryptoPrice;
    })
  );
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
        // Try CoinGecko first for live data
        try {
          const live = await fetchFromCoinGecko(requestedCoins);
          setPrices(live);
          setSource('coingecko');
        } catch {
          // Fall back to backend synthetic prices
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
