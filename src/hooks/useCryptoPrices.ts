import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CryptoPrice } from '@/types/crypto';
import { fetchBackendJson } from '@/lib/backendApi';

interface BackendPriceResponse {
  symbol: string;
  price: number;
  timestamp?: number;
}

interface CoinConfig {
  id: string;
  symbol: string;
  name: string;
  backendSymbol: string;
}

const DEFAULT_COINS: CoinConfig[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', backendSymbol: 'BTCUSDT' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', backendSymbol: 'ETHUSDT' },
  { id: 'solana', symbol: 'SOL', name: 'Solana', backendSymbol: 'SOLUSDT' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', backendSymbol: 'BNBUSDT' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', backendSymbol: 'ADAUSDT' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', backendSymbol: 'XRPUSDT' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', backendSymbol: 'DOTUSDT' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', backendSymbol: 'AVAXUSDT' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', backendSymbol: 'DOGEUSDT' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', backendSymbol: 'LINKUSDT' },
];

const COIN_LOOKUP = new Map(DEFAULT_COINS.map((coin) => [coin.id, coin]));

export function useCryptoPrices(symbols?: string[]) {
  const { session } = useAuth();
  const sessionBaselineRef = useRef<Map<string, number>>(new Map());

  const requestedCoins = useMemo(() => {
    if (!symbols?.length) {
      return DEFAULT_COINS;
    }

    return symbols
      .map((id) => COIN_LOOKUP.get(id))
      .filter((coin): coin is CoinConfig => Boolean(coin));
  }, [symbols]);

  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchPrices = useCallback(async () => {
    if (!session || requestedCoins.length === 0) {
      setPrices([]);
      setIsLoading(false);
      setError(null);
      setLastUpdate(null);
      sessionBaselineRef.current.clear();
      return;
    }

    try {
      setError(null);

      const updatedPrices = await Promise.all(
        requestedCoins.map(async (coin) => {
          const data = await fetchBackendJson<BackendPriceResponse>(
            `/price?symbol=${encodeURIComponent(coin.backendSymbol)}`
          );

          if (!sessionBaselineRef.current.has(coin.id)) {
            sessionBaselineRef.current.set(coin.id, data.price);
          }

          const baseline = sessionBaselineRef.current.get(coin.id) || data.price;
          const sessionChangePct = baseline === 0 ? 0 : ((data.price - baseline) / baseline) * 100;

          return {
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            price: data.price,
            change24h: Number(sessionChangePct.toFixed(2)),
            volume24h: 0,
            marketCap: 0,
            lastUpdated: new Date((data.timestamp || Date.now() / 1000) * 1000).toISOString(),
          } satisfies CryptoPrice;
        })
      );

      setPrices(updatedPrices);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prices');
    } finally {
      setIsLoading(false);
    }
  }, [requestedCoins, session]);

  useEffect(() => {
    fetchPrices();

    if (!session) {
      return;
    }

    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [fetchPrices, session]);

  return { prices, isLoading, error, lastUpdate, refetch: fetchPrices };
}
