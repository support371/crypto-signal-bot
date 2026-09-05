import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { PAPER_DASHBOARD_ROUTES } from '@/lib/paperDashboardRoutes';
import { normalizeWorkerSignal, type WorkerSignalResponse } from '@/lib/paperSignal';
import { CryptoPrice, MicrostructureFeatures, RiskAssessment, Signal } from '@/types/crypto';

interface SignalEngineConfig {
  riskTolerance: number;
  spreadStressThreshold: number;
  volatilitySensitivity: number;
  positionSizeFraction: number;
}

export function useSignalEngine(price: CryptoPrice | null, config: Partial<SignalEngineConfig> = {}) {
  // The paper Worker currently exposes signal evidence but no authoritative
  // risk-decision contract. Keep risk approval unavailable instead of deriving
  // executable authority in the browser.
  void config;

  const [signal, setSignal] = useState<Signal | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const expectedBackendSymbol = price ? price.symbol.toUpperCase() : null;

  const applyWorkerSignal = useCallback((data: WorkerSignalResponse) => {
    setSignal(expectedBackendSymbol ? normalizeWorkerSignal(data, expectedBackendSymbol) : null);
    setRisk(null);
    setMicrostructure(null);
  }, [expectedBackendSymbol]);

  useEffect(() => {
    if (!expectedBackendSymbol) {
      setSignal(null);
      setRisk(null);
      setMicrostructure(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const syncLatestSignal = async () => {
      try {
        const latest = await fetchBackendJson<WorkerSignalResponse>(
          `${PAPER_DASHBOARD_ROUTES.signalLatest}?symbol=${encodeURIComponent(expectedBackendSymbol)}`,
          { signal: controller.signal, timeoutMs: 20_000 },
        );
        applyWorkerSignal(latest);
      } catch (error) {
        if ((error as { name?: string })?.name !== 'AbortError') {
          console.error('Failed to fetch backend signal', error);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    setIsLoading(true);
    syncLatestSignal();
    const interval = window.setInterval(syncLatestSignal, 15000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [applyWorkerSignal, expectedBackendSymbol]);

  const refreshLatest = async () => {
    if (!expectedBackendSymbol) {
      return;
    }

    try {
      const latest = await fetchBackendJson<WorkerSignalResponse>(
        `${PAPER_DASHBOARD_ROUTES.signalLatest}?symbol=${encodeURIComponent(expectedBackendSymbol)}`,
        { timeoutMs: 20_000 },
      );
      applyWorkerSignal(latest);
    } catch (error) {
      console.error('Failed to refresh backend latest signal', error);
    }
  };

  return { signal, risk, microstructure, isLoading, refreshLatest };
}
