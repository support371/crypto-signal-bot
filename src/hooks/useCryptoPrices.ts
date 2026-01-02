import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CryptoPrice } from '@/types/crypto';
import { useAuth } from '@/contexts/AuthContext';
import { handleAuthError } from '@/lib/handleAuthError';

const DEFAULT_COINS = [
  'bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano',
  'ripple', 'polkadot', 'avalanche-2', 'dogecoin', 'chainlink'
];

export function useCryptoPrices(symbols?: string[]) {
  const { session, isLoading: authLoading } = useAuth();

  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchPrices = useCallback(async () => {
    // If not authenticated yet, don't call the backend function (it requires a user JWT).
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

      const { data, error: fnError } = await supabase.functions.invoke('crypto-prices', {
        body: { symbols: symbols || DEFAULT_COINS },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (fnError) throw new Error(fnError.message);

      if (data?.prices) {
        setPrices(data.prices);
        setLastUpdate(new Date());
      }
    } catch (err) {
      if (!handleAuthError(err)) {
        const message = err instanceof Error ? err.message : 'Failed to fetch prices';
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, session, symbols]);

  useEffect(() => {
    fetchPrices();

    if (authLoading || !session) return;

    // Refresh every 30 seconds
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [authLoading, session, fetchPrices]);

  return { prices, isLoading, error, lastUpdate, refetch: fetchPrices };
}

