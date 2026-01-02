import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CryptoPrice } from '@/types/crypto';
import { toast } from 'sonner';
import { handleAuthError } from '@/lib/handleAuthError';

export function useAIInsights() {
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const generateInsight = useCallback(async (
    priceData?: CryptoPrice,
    signal?: string,
    riskScore?: number
  ) => {
    setIsLoading(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const accessToken = authData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('ai-insights', {
        body: { priceData, signal, riskScore },
        ...(accessToken
          ? {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          : {}),
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.insight) {
        setInsight(data.insight);
      }
    } catch (err) {
      if (handleAuthError(err)) {
        setInsight(null);
        return;
      }

      const message = err instanceof Error ? err.message : 'Failed to generate insight';
      console.error('AI insight error:', err);

      if (message.includes('Rate limited')) {
        toast.error('AI rate limited - please try again later');
      } else if (message.includes('credits')) {
        toast.error('AI credits exhausted');
      }

      setInsight(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { insight, isLoading, generateInsight };
}
