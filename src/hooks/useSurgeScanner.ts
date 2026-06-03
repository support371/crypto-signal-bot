// src/hooks/useSurgeScanner.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
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

// ── Tiny audio ping using Web Audio API ───────────────────────────────────────
function playPing(type: 'surge' | 'stop_loss') {
  try {
    const AudioContextClass = window.AudioContext || (window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'stop_loss') {
      // Low urgent double-beep for stop-loss
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.setValueAtTime(200, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } else {
      // Crisp upward chime for surge
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Audio not available — silent fallback
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useSurgeScanner(soundEnabled = true) {
  const [status, setStatus] = useState<SurgeScannerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track previous alert state to detect new transitions
  const prevStatusRef = useRef<Record<string, SymbolSurgeStatus>>({});
  const prevAlertsRef = useRef<number>(0);
  const prevStopsRef = useRef<number>(0);

  const checkAlerts = useCallback(
    (next: SurgeScannerStatus) => {
      const prev = prevStatusRef.current;

      // ── Per-symbol state change notifications ───────────────────────────
      for (const [sym, data] of Object.entries(next.surge_status)) {
        const ticker = sym.replace('USDT', '');
        const prevData = prev[sym];

        // Only fire if type changed (avoid repeat toasts on same state)
        if (!prevData || prevData.type !== data.type) {
          if (data.type === 'STRONG_SURGE') {
            if (soundEnabled) playPing('surge');
            toast.success(`⚡ Strong Surge — ${ticker}`, {
              description: `+${data.pct_change.toFixed(1)}% in 20min · Buying ${((data.position_pct ?? 0.1) * 100).toFixed(0)}% of equity`,
              duration: 8000,
            });
          } else if (data.type === 'NORMAL_SURGE') {
            if (soundEnabled) playPing('surge');
            toast.info(`📈 Surge Detected — ${ticker}`, {
              description: `+${data.pct_change.toFixed(1)}% in 20min · Buying ${((data.position_pct ?? 0.05) * 100).toFixed(0)}% of equity`,
              duration: 6000,
            });
          } else if (data.type === 'STOP_LOSS_EXIT') {
            if (soundEnabled) playPing('stop_loss');
            toast.error(`🛡️ Stop-Loss Triggered — ${ticker}`, {
              description: `${data.pct_change.toFixed(1)}% loss · Position closed automatically`,
              duration: 10000,
            });
          }
        }
      }

      // ── Fallback: counter jumps (catches events before status window) ───
      if (next.alerts_fired > prevAlertsRef.current && Object.keys(prev).length > 0) {
        // Already handled per-symbol above
      }
      if (next.stop_losses_triggered > prevStopsRef.current && Object.keys(prev).length > 0) {
        // Already handled per-symbol above
      }

      prevStatusRef.current = { ...next.surge_status };
      prevAlertsRef.current = next.alerts_fired;
      prevStopsRef.current = next.stop_losses_triggered;
    },
    [soundEnabled],
  );

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fetchBackendJson('/surge/status');
      const next = data as SurgeScannerStatus;
      checkAlerts(next);
      setStatus(next);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg ?? 'Failed to fetch surge status');
    } finally {
      setIsLoading(false);
    }
  }, [checkAlerts]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  return { status, isLoading, error, refetch: fetchStatus };
}
