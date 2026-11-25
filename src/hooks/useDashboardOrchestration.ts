import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { WsTickerMessage, WsHealthMessage } from '@/hooks/useBackendWebSocket';
import { fetchBackendJson } from '@/lib/backend';

interface OrchestrationDeps {
  settings: { autoTradeEnabled: boolean };
  signal: { direction: string; confidence: number; regime: string } | null;
  risk: { approved: boolean; positionNotionalUsdt?: number; positionSize: number; score?: number } | null;
  selectedCoin: { id: string; symbol: string; price: number } | null;
  health: { kill_switch_active?: boolean; mode?: string } | null;
  systemMode: string;
  preferBackendPrices: boolean;
  selectedBackendSymbol: string | null;
  refetchStatus: () => void;
  refetchGuardian: () => void;
  refetchPortfolio: () => void;
  refetchEarnings: () => void;
  refetchAudit: () => void;
  refetchMetrics: () => void;
  refetchPrices: () => void;
  refreshLatestSignal: () => void;
}

export function useDashboardOrchestration(deps: OrchestrationDeps) {
  const {
    settings, signal, risk, selectedCoin, health, systemMode,
    preferBackendPrices, selectedBackendSymbol,
    refetchStatus, refetchGuardian, refetchPortfolio,
    refetchEarnings, refetchAudit, refetchMetrics,
    refetchPrices, refreshLatestSignal,
  } = deps;

  const lastAutoTradeSig = useRef<string | null>(null);

  useEffect(() => {
    if (
      !settings.autoTradeEnabled ||
      !signal ||
      !risk ||
      !risk.approved ||
      !selectedCoin ||
      health?.kill_switch_active
    ) {
      return;
    }

    if (systemMode === 'live') {
      toast.warning('Auto-trade skipped: live execution is disabled. Certification controls remain enforced.', { duration: 5000 });
      return;
    }

    const sig = `${selectedCoin.id}:${signal.direction}:${signal.regime}`;
    if (sig === lastAutoTradeSig.current) return;
    lastAutoTradeSig.current = sig;

    const side = signal.direction === 'DOWN' ? 'SELL' : 'BUY';
    const notional = risk.positionNotionalUsdt && risk.positionNotionalUsdt > 0
      ? risk.positionNotionalUsdt
      : risk.positionSize * 1000;
    const qty = selectedCoin.price > 0
      ? Number((notional / selectedCoin.price).toFixed(6))
      : 0.001;

    fetchBackendJson('/intent/paper', {
      method: 'POST',
      body: JSON.stringify({
        symbol: `${selectedCoin.symbol.toUpperCase()}USDT`,
        side,
        order_type: 'MARKET',
        quantity: Math.max(qty, 0.0001),
        price: selectedCoin.price,
      }),
    })
      .then(() => {
        toast.info(
          `Certification rehearsal: ${side} ${selectedCoin.symbol} (confidence ${signal.confidence}%)`,
          { duration: 5000 }
        );
        refetchPortfolio();
        refetchAudit();
        refetchMetrics();
        refetchStatus();
      })
      .catch(() => {
        // Silently swallow — guardian, balance, or risk rejection; next poll will re-evaluate.
      });
  }, [
    health?.kill_switch_active,
    refetchAudit,
    refetchMetrics,
    refetchPortfolio,
    refetchStatus,
    risk,
    selectedCoin,
    settings.autoTradeEnabled,
    signal,
    systemMode,
  ]);

  const handleHealthUpdate = useCallback(
    (_msg: WsHealthMessage) => {
      refetchStatus();
    },
    [refetchStatus]
  );

  const handleGuardianAlert = useCallback(
    (msg: { reason: string; kill_switch_active: boolean }) => {
      toast.error(`Guardian alert: ${msg.reason}`, { duration: 8000 });
      refetchStatus();
      refetchGuardian();
      refetchAudit();
      refetchMetrics();
    },
    [refetchStatus, refetchGuardian, refetchAudit, refetchMetrics]
  );

  const handleKillSwitchChange = useCallback(() => {
    refetchStatus();
    refetchGuardian();
    refetchAudit();
    refetchMetrics();
  }, [refetchStatus, refetchGuardian, refetchAudit, refetchMetrics]);

  const handleMarketUpdate = useCallback(() => {
    if (preferBackendPrices) {
      refetchPrices();
    }
    refreshLatestSignal();
  }, [preferBackendPrices, refetchPrices, refreshLatestSignal]);

  const handleExchangeStatus = useCallback(() => {
    refetchStatus();
    refetchGuardian();
    if (preferBackendPrices) {
      refetchPrices();
    }
    refreshLatestSignal();
  }, [preferBackendPrices, refetchGuardian, refetchPrices, refetchStatus, refreshLatestSignal]);

  const handleOrderUpdate = useCallback(
    (msg: { status: string; symbol: string; side: string; fill_price: number | null }) => {
      if (msg.status === 'FILLED') {
        toast.success(
          `Order filled: ${msg.side} ${msg.symbol}${msg.fill_price ? ` @ ${msg.fill_price}` : ''}`
        );
        refetchStatus();
        refetchPortfolio();
        refetchEarnings();
        refetchAudit();
        refetchMetrics();
        const normalizedMsgSymbol = msg.symbol.toUpperCase().replace(/(USDT|USD)$/i, '');
        const normalizedSelectedSymbol = selectedBackendSymbol?.replace(/(USDT|USD)$/i, '');
        if (!normalizedSelectedSymbol || normalizedMsgSymbol === normalizedSelectedSymbol) {
          refreshLatestSignal();
        }
      }
    },
    [refetchStatus, refetchPortfolio, refetchEarnings, refetchAudit, refetchMetrics, refreshLatestSignal, selectedBackendSymbol]
  );

  const handlePortfolioActionComplete = useCallback(() => {
    refetchStatus();
    refetchGuardian();
    refetchPortfolio();
    refetchEarnings();
    refetchAudit();
    refetchMetrics();
  }, [refetchStatus, refetchGuardian, refetchPortfolio, refetchEarnings, refetchAudit, refetchMetrics]);

  const handleEarningsReset = useCallback(() => {
    refetchEarnings();
    refetchAudit();
    refetchMetrics();
  }, [refetchEarnings, refetchAudit, refetchMetrics]);

  const handleTickerUpdate = useCallback(
    (_msg: WsTickerMessage) => {
      // Ticker updates are currently consumed through REST refreshes.
    },
    []
  );

  const clearAutoTradeSignature = useCallback(() => {
    lastAutoTradeSig.current = null;
  }, []);

  return {
    handleHealthUpdate,
    handleGuardianAlert,
    handleKillSwitchChange,
    handleMarketUpdate,
    handleExchangeStatus,
    handleOrderUpdate,
    handlePortfolioActionComplete,
    handleEarningsReset,
    handleTickerUpdate,
    clearAutoTradeSignature,
  };
}
