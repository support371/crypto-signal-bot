import { useEffect, useMemo, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { CryptoPrice, MicrostructureFeatures, RiskAssessment, Signal } from '@/types/crypto';

interface SignalEngineConfig {
  riskTolerance: number;
  spreadStressThreshold: number;
  volatilitySensitivity: number;
  positionSizeFraction: number;
}

interface MarketStateResponse {
  signal: Signal;
  risk: RiskAssessment;
  microstructure: MicrostructureFeatures;
}

const DEFAULT_CONFIG: SignalEngineConfig = {
  riskTolerance: 0.5,
  spreadStressThreshold: 0.002,
  volatilitySensitivity: 0.5,
  positionSizeFraction: 0.1,
};

export function useSignalEngine(price: CryptoPrice | null, config: Partial<SignalEngineConfig> = {}) {
  const mergedConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [
      config.positionSizeFraction,
      config.riskTolerance,
      config.spreadStressThreshold,
      config.volatilitySensitivity,
    ]
  );

  const [signal, setSignal] = useState<Signal | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);

  useEffect(() => {
    if (!price) {
      setSignal(null);
      setRisk(null);
      setMicrostructure(null);
      return;
    }

    const controller = new AbortController();

    const fetchMarketState = async () => {
      try {
        const data = await fetchBackendJson<MarketStateResponse>('/market-state', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            symbol: price.symbol.toUpperCase(),
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

        setSignal(data.signal);
        setRisk(data.risk);
        setMicrostructure(data.microstructure);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.error('Failed to fetch backend market state', error);
        setSignal(null);
        setRisk(null);
        setMicrostructure(null);
      }
    };

    fetchMarketState();

    return () => controller.abort();
  }, [
    mergedConfig.positionSizeFraction,
    mergedConfig.riskTolerance,
    mergedConfig.spreadStressThreshold,
    mergedConfig.volatilitySensitivity,
    price?.change24h,
    price?.id,
    price?.marketCap,
    price?.price,
    price?.symbol,
    price?.volume24h,
  ]);

  return { signal, risk, microstructure };
}
