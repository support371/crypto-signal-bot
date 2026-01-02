import { useState, useEffect, useCallback } from 'react';
import { CryptoPrice } from '@/types/crypto';
import { useAuth } from '@/contexts/AuthContext';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

const DEFAULT_COINS = [
  'bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano',
  'ripple', 'polkadot', 'avalanche-2', 'dogecoin', 'chainlink'
];

interface CryptoPricesResponse {
  prices: CryptoPrice[];
}

export function useCryptoPrices(symbols?: string[]) {
  const { session, isLoading: authLoading } = useAuth();

  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchPrices = useCallback(async () => {
    if (authLoading) return;
    if (!session) {
      setIsLoading(false);
      setPrices([]);
      setLastUpdate(null);
      setError(null);
      return;
    }

    try {
      setError(null);

      const { data, error: invokeError } = await invokeEdgeFunction<CryptoPricesResponse>(
        'crypto-prices',
        { body: { symbols: symbols || DEFAULT_COINS } }
      );

      if (invokeError) throw invokeError;

      if (data?.prices) {
        setPrices(data.prices);
        setLastUpdate(new Date());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch prices';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, session, symbols]);

  useEffect(() => {
    fetchPrices();

    if (authLoading || !session) return;

    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [authLoading, session, fetchPrices]);

  return { prices, isLoading, error, lastUpdate, refetch: fetchPrices };
}
