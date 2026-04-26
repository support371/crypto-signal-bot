import { useState, useCallback } from 'react';
import { CryptoPrice } from '@/types/crypto';
import { toast } from 'sonner';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { SUPABASE_CONFIGURED } from '@/integrations/supabase/config';

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
    // Edge function requires Supabase — skip silently in local mode.
    if (!SUPABASE_CONFIGURED) return;

    setIsLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<AIInsightResponse>(
        'ai-insights',
        { body: { priceData, signal, riskScore } }
      );

      if (error) throw error;

      if (data?.insight) {
        setInsight(data.insight);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate insight';
      console.error('AI insight error:', err);

      const lower = message.toLowerCase();
      if (lower.includes('not authenticated') || lower.includes('401')) {
        // Auth error — banner already triggered by invokeEdgeFunction
      } else if (lower.includes('rate limit') || lower.includes('429')) {
        toast.error('AI rate limited — please try again later');
      } else if (lower.includes('credits')) {
        toast.error('AI credits exhausted');
      } else if (lower.includes('network') || lower.includes('fetch') || lower.includes('load failed')) {
        toast.error('Network error — could not reach AI service');
      } else {
        toast.error('Failed to generate AI insight. Please try again.');
      }

      setInsight(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { insight, isLoading, generateInsight, available: SUPABASE_CONFIGURED };
}
