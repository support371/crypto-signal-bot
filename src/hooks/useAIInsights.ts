import { useState, useCallback } from 'react';
import { CryptoPrice } from '@/types/crypto';
import { toast } from 'sonner';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

interface AIInsightResponse {
  insight: string;
}

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
      const { data, error } = await invokeEdgeFunction<AIInsightResponse>(
        'ai-insights',
        { body: { priceData, signal, riskScore } }
      );

      if (error) {
        throw error;
      }

      if (data?.insight) {
        setInsight(data.insight);
      }
    } catch (err) {
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
