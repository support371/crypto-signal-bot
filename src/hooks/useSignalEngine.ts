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

interface WorkerRiskDecisionResponse {
  approved?: boolean;
  decision?: string;
  position_size_fraction?: number;
  position_notional_usdt?: number;
  risk_score?: number;
  reasoning?: string;
  guardian_halted?: boolean;
}

function normalizeWorkerRiskDecision(
  data: WorkerRiskDecisionResponse,
  signal: Signal | null,
): RiskAssessment | null {
  if (!data || typeof data !== 'object') return null;
  const approved = data.approved === true;
  const score = Number(data.risk_score);
  const fraction = Number(data.position_size_fraction);
  const notional = Number(data.position_notional_usdt);
  const direction = signal?.direction;
  return {
    score: Number.isFinite(score) ? Math.round(Math.max(0, Math.min(100, score))) : 0,
    decision: !approved || direction === 'NEUTRAL' || !direction
      ? 'HOLD'
      : direction === 'DOWN'
        ? 'ENTER_SHORT'
        : 'ENTER_LONG',
    approved,
    positionSize: Number.isFinite(fraction) && fraction > 0 ? fraction : 0,
    positionNotionalUsdt: Number.isFinite(notional) && notional > 0 ? notional : 0,
    reasoning: typeof data.reasoning === 'string' && data.reasoning.length > 0
      ? data.reasoning
      : 'Worker risk engine decision unavailable.',
  };
}

export function useSignalEngine(price: CryptoPrice | null, config: Partial<SignalEngineConfig> = {}) {
  // Risk approval is authoritative server-side: the browser consumes the
  // Worker's GET /risk/decision read-only and never derives its own
  // executable authority. If the endpoint is unavailable (older Worker),
  // risk stays null and rehearsal remains disabled — the previous behavior.
  void config;

  const [signal, setSignal] = useState<Signal | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const expectedBackendSymbol = price ? price.symbol.toUpperCase() : null;

  const syncRiskDecision = useCallback(async (
    currentSignal: Signal | null,
    abortSignal?: AbortSignal,
  ) => {
    if (!expectedBackendSymbol) {
      setRisk(null);
      return;
    }
    try {
      const decision = await fetchBackendJson<WorkerRiskDecisionResponse>(
        `/risk/decision?symbol=${encodeURIComponent(expectedBackendSymbol)}`,
        { signal: abortSignal, timeoutMs: 20_000 },
      );
      setRisk(normalizeWorkerRiskDecision(decision, currentSignal));
    } catch {
      // Older Worker without the endpoint, or unreachable backend:
      // keep rehearsal disabled rather than inventing a decision.
      setRisk(null);
    }
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
        const normalized = expectedBackendSymbol
          ? normalizeWorkerSignal(latest, expectedBackendSymbol)
          : null;
        setSignal(normalized);
        setMicrostructure(null);
        await syncRiskDecision(normalized, controller.signal);
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
  }, [expectedBackendSymbol, syncRiskDecision]);

  const refreshLatest = async () => {
    if (!expectedBackendSymbol) {
      return;
    }

    try {
      const latest = await fetchBackendJson<WorkerSignalResponse>(
        `${PAPER_DASHBOARD_ROUTES.signalLatest}?symbol=${encodeURIComponent(expectedBackendSymbol)}`,
        { timeoutMs: 20_000 },
      );
      const normalized = normalizeWorkerSignal(latest, expectedBackendSymbol);
      setSignal(normalized);
      setMicrostructure(null);
      await syncRiskDecision(normalized);
    } catch (error) {
      console.error('Failed to refresh backend latest signal', error);
    }
  };

  return { signal, risk, microstructure, isLoading, refreshLatest };
}
