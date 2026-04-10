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

        applySnapshot(data);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.error('Failed to fetch backend market state', error);
        setSignal(null);
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
        const latest = await fetchBackendJson<LatestSignalResponse>(
          `/signal/latest?symbol=${encodeURIComponent(expectedBackendSymbol)}`,
          { signal: controller.signal }
        );
        if (!latest.available) {
          return;
        }
        if (latest.symbol && latest.symbol !== expectedBackendSymbol) {
          return;
        }
        applySnapshot(latest);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Failed to fetch backend latest signal', error);
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
      const latest = await fetchBackendJson<LatestSignalResponse>(
        `/signal/latest?symbol=${encodeURIComponent(expectedBackendSymbol)}`
      );
      if (!latest.available) {
        return;
      }
      if (latest.symbol && latest.symbol !== expectedBackendSymbol) {
        return;
      }
      applySnapshot(latest);
    } catch (error) {
      console.error('Failed to refresh backend latest signal', error);
    }
  };

  return { signal, risk, microstructure, isLoading, refreshLatest };
}
