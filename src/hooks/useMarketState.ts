/**
 * src/hooks/useMarketState.ts
 *
 * PHASE 3 — Market state hook: backend-only risk configuration.
 *
 * REMOVED (phase 3):
 *   - riskTolerance, spreadStressThreshold, volatilitySensitivity,
 *     positionSizeFraction from POST /market-state body  (finding F7)
 *   - These are now owned by the backend via GET/PUT /risk/config.
 *     The frontend never sends risk parameters to influence signal or
 *     risk engine output.
 *
 * RULE 7: There is one source of truth for risk config — the backend.
 * RULE 8: Risk always overrides strategy.
 *
 * The /market-state POST body is now reduced to market observation inputs only.
 * All risk thresholds, position sizing, and tolerance values are backend-owned.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { CoinPrice } from "@/hooks/usePrices";

// ---------------------------------------------------------------------------
// Types (unchanged shape from Phase 1 confirmed bundle)
// ---------------------------------------------------------------------------

export interface SignalState {
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  regime: "TREND" | "RANGE" | "CHAOS";
  horizon: number; // minutes
  symbol?: string;
  available: boolean;
}

export interface RiskState {
  score: number;
  decision: "ENTER_LONG" | "ENTER_SHORT" | "EXIT" | "HOLD";
  approved: boolean;
  positionSize: number; // fraction of NAV — from backend, not client
  reasoning?: string;
}

export interface MicrostructureState {
  spreadPercentage: number;
  orderBookImbalance: number;
  midPriceVelocity: number;
  volatilitySpike: boolean;
  depthDecay: number;
}

interface MarketStateResponse {
  signal:        SignalState;
  risk:          RiskState;
  microstructure: MicrostructureState;
}

interface LatestSignalResponse extends SignalState {
  // available is already on SignalState
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseMarketStateResult {
  signal:          SignalState | null;
  risk:            RiskState | null;
  microstructure:  MicrostructureState | null;
  isLoading:       boolean;
  refreshLatest:   () => Promise<void>;
}

const SIGNAL_POLL_MS = 15_000;

export function useMarketState(
  selectedCoin: CoinPrice | null
): UseMarketStateResult {
  const [signal,        setSignal]        = useState<SignalState | null>(null);
  const [risk,          setRisk]          = useState<RiskState | null>(null);
  const [microstructure, setMicrostructure] = useState<MicrostructureState | null>(null);
  const [isLoading,     setIsLoading]     = useState(true);

  const symbol = selectedCoin ? `${selectedCoin.symbol.toUpperCase()}USDT` : null;

  // Update all three states from a combined response
  const applyResponse = useCallback((data: MarketStateResponse) => {
    setSignal(data.signal);
    setRisk(data.risk);
    setMicrostructure(data.microstructure);
  }, []);

  // POST /market-state — market observation inputs only, NO risk params from client
  useEffect(() => {
    if (!selectedCoin) {
      setSignal(null);
      setRisk(null);
      setMicrostructure(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        setIsLoading(true);
        const data = await apiFetch<MarketStateResponse>("/market-state", {
          method:  "POST",
          signal:  controller.signal,
          body:    JSON.stringify({
            symbol:     symbol,
            price:      selectedCoin.price,
            change24h:  selectedCoin.change24h,
            volume24h:  selectedCoin.volume24h,
            marketCap:  selectedCoin.marketCap,
            // ----------------------------------------------------------------
            // PHASE 3: riskTolerance, spreadStressThreshold,
            //          volatilitySensitivity, positionSizeFraction
            //          are intentionally OMITTED.
            // The backend reads its own config via GET /risk/config.
            // Client localStorage settings no longer influence backend output.
            // ----------------------------------------------------------------
          }),
        });
        applyResponse(data);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        // On error, leave existing values — don't zero out valid signal/risk.
        console.error("[useMarketState] /market-state failed:", err);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [symbol, selectedCoin?.price, selectedCoin?.change24h, applyResponse]);

  // GET /signal/latest — poll for freshest signal without re-posting market state
  useEffect(() => {
    if (!symbol) return;

    const controller = new AbortController();

    const poll = async () => {
      try {
        const data = await apiFetch<LatestSignalResponse>(
          `/signal/latest?symbol=${encodeURIComponent(symbol)}`,
          { signal: controller.signal }
        );
        if (!data.available || (data.symbol && data.symbol !== symbol)) return;
        setSignal(data);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        console.error("[useMarketState] /signal/latest failed:", err);
      }
    };

    poll();
    const interval = setInterval(poll, SIGNAL_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [symbol]);

  const refreshLatest = useCallback(async () => {
    if (!symbol) return;
    try {
      const data = await apiFetch<LatestSignalResponse>(
        `/signal/latest?symbol=${encodeURIComponent(symbol)}`
      );
      if (!data.available || (data.symbol && data.symbol !== symbol)) return;
      setSignal(data);
    } catch (err) {
      console.error("[useMarketState] refreshLatest failed:", err);
    }
  }, [symbol]);

  return { signal, risk, microstructure, isLoading, refreshLatest };
}
