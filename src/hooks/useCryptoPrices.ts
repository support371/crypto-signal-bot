import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CryptoPrice } from '@/types/crypto';

const DEFAULT_COINS = [
  'bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano', 
  'ripple', 'polkadot', 'avalanche-2', 'dogecoin', 'chainlink'
];

export function useCryptoPrices(symbols?: string[]) {
  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      setError(null);
      const { data, error: fnError } = await supabase.functions.invoke('crypto-prices', {
        body: { symbols: symbols || DEFAULT_COINS }
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      if (data?.prices) {
        setPrices(data.prices);
        setLastUpdate(new Date());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch prices';
      setError(message);
      console.error('Price fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [symbols]);

  useEffect(() => {
    fetchPrices();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchPrices, 30000);
    
    return () => clearInterval(interval);
  }, [fetchPrices]);

  return { prices, isLoading, error, lastUpdate, refetch: fetchPrices };
}
