import { useMemo } from 'react';
import { CryptoPrice, Signal, RiskAssessment, MicrostructureFeatures } from '@/types/crypto';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000'; // The address of our Python backend

// Fetch function for intents
const fetchLatestIntent = async (symbol: string) => {
  // In a real app, you'd filter by symbol
  const { data } = await axios.get(`${API_BASE_URL}/intents/latest`);
  // For now, just return the latest intent if available
  return data.length > 0 ? data[0] : null;
};

// Fetch function for backend status
const fetchBackendStatus = async () => {
  const { data } = await axios.get(`${API_BASE_URL}/status`);
  return data;
};

export function useSignalEngine(price: CryptoPrice | null) {
  const symbol = price?.id || 'bitcoin';

  const { data: latestIntent, isLoading: isIntentLoading } = useQuery({
    queryKey: ['latestIntent', symbol],
    queryFn: () => fetchLatestIntent(symbol),
    refetchInterval: 5000, // Refetch every 5 seconds
    enabled: !!price,
  });

  const { data: backendStatus } = useQuery({
    queryKey: ['backendStatus'],
    queryFn: fetchBackendStatus,
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  // Adapt the backend data to the existing frontend types
  const signal = useMemo<Signal | null>(() => {
    if (!latestIntent) return null;
    // This is a simplified mapping. In a real app, you might get the signal directly.
    return {
      direction: latestIntent.action === 'ENTER_LONG' ? 'UP' : latestIntent.action === 'REDUCE' ? 'DOWN' : 'NEUTRAL',
      confidence: (100 - latestIntent.risk_score), // Infer confidence from risk score
      regime: 'TREND', // Placeholder
      horizon: 60,
    };
  }, [latestIntent]);

  const risk = useMemo<RiskAssessment | null>(() => {
    if (!latestIntent || !backendStatus) return null;
    return {
      score: Math.round(latestIntent.risk_score),
      decision: latestIntent.action,
      approved: !backendStatus.is_frozen && !backendStatus.global_kill_switch,
      positionSize: latestIntent.size_fraction,
      reasoning: latestIntent.reason,
    };
  }, [latestIntent, backendStatus]);

  const microstructure = useMemo<MicrostructureFeatures | null>(() => {
    // This data is no longer simulated. We can show a placeholder or get it from a new endpoint.
    // For now, we'll return a static placeholder.
    if (!price) return null;
    return {
      spreadPercentage: 0.0015,
      orderBookImbalance: 0.1,
      midPriceVelocity: 0.0,
      volatilitySpike: false,
      depthDecay: 0.0,
    };
  }, [price]);

  return { signal, risk, microstructure, isLoading: isIntentLoading };
}
