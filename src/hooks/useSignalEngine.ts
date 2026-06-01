import { useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { CryptoPrice, MicrostructureFeatures, RiskAssessment, Signal } from '@/types/crypto';

interface SignalEngineConfig {
  riskTolerance: number;
  spreadStressThreshold: number;
  volatilitySensitivity: number;
  positionSizeFraction: number;
}

interface MarketStateResponse {
  symbol?: string;
  signal: Signal;
  risk: RiskAssessment;
  microstructure: MicrostructureFeatures;
}

interface LatestSignalResponse extends MarketStateResponse {
  available: boolean;
  timestamp?: number;
}

const DEFAULT_CONFIG: SignalEngineConfig = {
  riskTolerance: 0.5,
  spreadStressThreshold: 0.002,
  volatilitySensitivity: 0.5,
  positionSizeFraction: 0.1,
};

export function useSignalEngine(price: CryptoPrice | null, config: Partial<SignalEngineConfig> = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const [signal, setSignal] = useState<Signal | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const expectedBackendSymbol = price ? `${price.symbol.toUpperCase()}USDT` : null;

  const applySnapshot = (data: MarketStateResponse) => {
    setSignal(data.signal);
    setRisk(data.risk);
    setMicrostructure(data.microstructure);
  };

  // applyRiskOnly: update risk/microstructure from market-state without overwriting
  // a real signal already loaded from the signal engine
  const applyRiskOnly = (data: MarketStateResponse) => {
    setRisk(data.risk);
    setMicrostructure(data.microstructure);
    // Only update signal if we don't already have a strong signal from the engine
    setSignal(prev => {
      const incoming = data.signal;
      if (!incoming) return prev;
      // Keep existing strong signal; only accept market-state signal if it's non-neutral
      if (prev && prev.confidence > 50) return prev;
      return incoming;
    });
  };

  useEffect(() => {
    if (!price) {
      setSignal(null);
      setRisk(null);
      setMicrostructure(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const fetchMarketState = async () => {
      try {
        setIsLoading(true);
        const data = await fetchBackendJson<MarketStateResponse>('/market-state', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            symbol: expectedBackendSymbol,
            price: price.price,
            change24h: price.change24h,
            volume24h: price.volume24h,
            marketCap: price.marketCap,
            riskTolerance: mergedConfig.riskTolerance,
            spreadStressThreshold: mergedConfig.spreadStressThreshold,
            volatilitySensitivity: mergedConfig.volatilitySensitivity,
            positionSizeFraction: mergedConfig.positionSizeFraction,
          }),
        });

        applyRiskOnly(data);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.error('Failed to fetch backend market state', error);
        // Don't clear signal on market-state failure — keep last known signal engine data
        setRisk(null);
        setMicrostructure(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchMarketState();

    return () => controller.abort();
  }, [
    expectedBackendSymbol,
    mergedConfig.positionSizeFraction,
    mergedConfig.riskTolerance,
    mergedConfig.spreadStressThreshold,
    mergedConfig.volatilitySensitivity,
    price,
  ]);

  useEffect(() => {
    if (!expectedBackendSymbol) {
      return;
    }

    const controller = new AbortController();

    const syncLatestSignal = async () => {
      try {
        // Primary: use the real signal engine endpoint (/api/v1/signals/:symbol)
        // which returns RSI/EMA/MACD-based signals with proper confidence scores
        const engineSignal = await fetchBackendJson<{
          id: string;
          symbol: string;
          side: string;
          confidence: number;
          entry_price: number;
          stop_loss: number;
          take_profit: number;
          strategy_id: string;
          metadata?: Record<string, unknown>;
        }>(`/api/v1/signals/${encodeURIComponent(expectedBackendSymbol)}`, { signal: controller.signal });

        // Map the signal engine response to our Signal/Risk shape
        const direction = engineSignal.side as 'BUY' | 'SELL' | 'NEUTRAL';
        const confidencePct = Math.round(engineSignal.confidence * 100);
        setSignal({
          direction,
          confidence: confidencePct,
          regime: confidencePct >= 65 ? (direction === 'BUY' ? 'TRENDING_UP' : 'TRENDING_DOWN') : 'RANGE',
          horizon: 60,
        });
        setRisk({
          score: confidencePct >= 65 ? Math.round(confidencePct * 0.4) : 20,
          decision: confidencePct >= 65 ? direction : 'HOLD',
          approved: confidencePct >= 65,
          positionSize: confidencePct >= 65 ? 0.1 : 0,
          reasoning: confidencePct >= 65
            ? `${engineSignal.strategy_id} strategy — ${confidencePct}% confidence`
            : 'Signal not strong enough',
        });
      } catch (primaryError) {
        if ((primaryError as { name?: string })?.name === 'AbortError') return;

        // Fallback: use the legacy /signal/latest endpoint
        try {
          const latest = await fetchBackendJson<LatestSignalResponse>(
            `/signal/latest?symbol=${encodeURIComponent(expectedBackendSymbol)}`,
            { signal: controller.signal }
          );
          if (!latest.available) return;
          if (latest.symbol && latest.symbol !== expectedBackendSymbol) return;
          applySnapshot(latest);
        } catch (fallbackError) {
          if ((fallbackError as { name?: string })?.name !== 'AbortError') {
            console.error('Failed to fetch signal (both engines)', fallbackError);
          }
        }
      }
    };

    syncLatestSignal();
    const interval = window.setInterval(syncLatestSignal, 15000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [expectedBackendSymbol]);

  const refreshLatest = async () => {
    if (!expectedBackendSymbol) {
      return;
    }

    try {
      const engineSignal = await fetchBackendJson<{
        side: string;
        confidence: number;
        strategy_id: string;
      }>(`/api/v1/signals/${encodeURIComponent(expectedBackendSymbol)}`);

      const direction = engineSignal.side as 'BUY' | 'SELL' | 'NEUTRAL';
      const confidencePct = Math.round(engineSignal.confidence * 100);
      setSignal({
        direction,
        confidence: confidencePct,
        regime: confidencePct >= 65 ? (direction === 'BUY' ? 'TRENDING_UP' : 'TRENDING_DOWN') : 'RANGE',
        horizon: 60,
      });
      setRisk({
        score: confidencePct >= 65 ? Math.round(confidencePct * 0.4) : 20,
        decision: confidencePct >= 65 ? direction : 'HOLD',
        approved: confidencePct >= 65,
        positionSize: confidencePct >= 65 ? 0.1 : 0,
        reasoning: confidencePct >= 65
          ? `${engineSignal.strategy_id} — ${confidencePct}% confidence`
          : 'Signal not strong enough',
      });
    } catch (error) {
      console.error('Failed to refresh backend latest signal', error);
    }
  };

  return { signal, risk, microstructure, isLoading, refreshLatest };
}
