// src/hooks/useSurgeScanner.ts
import { useState, useEffect, useCallback } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface SurgeScannerConfig {
  scan_interval_seconds: number;
  window_minutes: number;
  stop_loss_pct: number;
  surge_threshold_mid: number;
  surge_threshold_high: number;
  normal_position_pct: number;
  strong_position_pct: number;
}

export interface SymbolSurgeStatus {
  type: 'WATCHING' | 'NORMAL_SURGE' | 'STRONG_SURGE' | 'STOP_LOSS_EXIT';
  pct_change: number;
  ref_age_minutes?: number;
  position_pct?: number;
  at: number;
}

export interface SurgeScannerStatus {
  running: boolean;
  run_count: number;
  last_run_at: number;
  alerts_fired: number;
  stop_losses_triggered: number;
  watched_symbols: string[];
  surge_status: Record<string, SymbolSurgeStatus>;
  config: SurgeScannerConfig;
}

const POLL_INTERVAL = 15_000; // 15 seconds

export function useSurgeScanner() {
  const [status, setStatus] = useState<SurgeScannerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      const data = await fetchBackendJson('/surge/status');
      setStatus(data as SurgeScannerStatus);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to fetch surge status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetch]);

  return { status, isLoading, error, refetch: fetch };
}
