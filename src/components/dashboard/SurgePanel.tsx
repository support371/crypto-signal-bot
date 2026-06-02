// src/components/dashboard/SurgePanel.tsx
import { useState } from 'react';
import { Zap, ShieldCheck, TrendingUp, AlertTriangle, RefreshCw, Activity, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SurgeScannerStatus, SymbolSurgeStatus } from '@/hooks/useSurgeScanner';

interface SurgePanelProps {
  status: SurgeScannerStatus | null;
  isLoading?: boolean;
  error?: string | null;
  onRefetch?: () => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

const ALERT_META: Record<
  SymbolSurgeStatus['type'],
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  WATCHING: {
    label: 'Watching',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30',
    border: 'border-border',
    icon: <Activity className="w-3 h-3" />,
  },
  NORMAL_SURGE: {
    label: 'Surge 5–10%',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    icon: <TrendingUp className="w-3 h-3" />,
  },
  STRONG_SURGE: {
    label: 'Strong Surge 15%+',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: <Zap className="w-3 h-3" />,
  },
  STOP_LOSS_EXIT: {
    label: 'Stop-Loss Exit',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

function SymbolRow({ symbol, data }: { symbol: string; data: SymbolSurgeStatus }) {
  const meta = ALERT_META[data.type] ?? ALERT_META.WATCHING;
  const ticker = symbol.replace('USDT', '');
  const pct = data.pct_change ?? 0;
  const sign = pct >= 0 ? '+' : '';
  const isActive = data.type === 'NORMAL_SURGE' || data.type === 'STRONG_SURGE';
  const isStop   = data.type === 'STOP_LOSS_EXIT';

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg px-3 py-2.5 border text-xs font-mono transition-all duration-500',
        meta.bg,
        meta.border,
        isActive && 'ring-1 ring-yellow-500/20',
        isStop  && 'ring-1 ring-red-500/30',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('flex items-center gap-1', meta.color, isActive && 'animate-pulse')}>
          {meta.icon}
        </span>
        <span className="font-bold text-foreground text-sm">{ticker}</span>
        <span className={cn('text-[10px]', meta.color)}>{meta.label}</span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className={cn(
            'font-bold text-sm',
            pct > 0   ? 'text-emerald-400'      :
            pct < -0.01 ? 'text-red-400'        :
            'text-muted-foreground',
          )}
        >
          {sign}{pct.toFixed(2)}%
        </span>
        {data.position_pct !== undefined && data.position_pct > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {(data.position_pct * 100).toFixed(0)}% eq
          </span>
        )}
      </div>
    </div>
  );
}

export function SurgePanel({
  status,
  isLoading,
  error,
  onRefetch,
  soundEnabled = true,
  onToggleSound,
}: SurgePanelProps) {
  const hasStatus    = !!status;
  const isRunning    = status?.running ?? false;
  const totalAlerts  = status?.alerts_fired ?? 0;
  const stopLosses   = status?.stop_losses_triggered ?? 0;
  const surgeStatus  = status?.surge_status ?? {};
  const watchedSyms  = status?.watched_symbols ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

  const activeSurges = Object.values(surgeStatus).filter(
    (s) => s.type === 'NORMAL_SURGE' || s.type === 'STRONG_SURGE',
  ).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap
            className={cn(
              'w-4 h-4',
              activeSurges > 0 ? 'text-yellow-400 animate-pulse' :
              isRunning        ? 'text-emerald-400'              :
              'text-muted-foreground',
            )}
          />
          <span className="text-sm font-semibold tracking-tight">Surge Scanner</span>
          {isRunning && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-mono">
              LIVE
            </span>
          )}
          {activeSurges > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 font-mono animate-pulse">
              {activeSurges} ACTIVE
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Sound toggle */}
          <button
            onClick={onToggleSound}
            title={soundEnabled ? 'Mute alerts' : 'Enable alert sounds'}
            className={cn(
              'transition-colors',
              soundEnabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {soundEnabled
              ? <Volume2 className="w-3.5 h-3.5" />
              : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          {/* Refresh */}
          <button
            onClick={onRefetch}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <div className="flex flex-col items-center py-3">
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Alerts Fired</span>
          <span className="text-xl font-bold font-mono text-foreground">{totalAlerts}</span>
        </div>
        <div className="flex flex-col items-center py-3">
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Stops Hit</span>
          <span className={cn('text-xl font-bold font-mono', stopLosses > 0 ? 'text-red-400' : 'text-foreground')}>
            {stopLosses}
          </span>
        </div>
        <div className="flex flex-col items-center py-3">
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Active Now</span>
          <span className={cn('text-xl font-bold font-mono', activeSurges > 0 ? 'text-yellow-400' : 'text-muted-foreground')}>
            {activeSurges}
          </span>
        </div>
      </div>

      {/* ── Config pills ───────────────────────────────────────────────── */}
      {status?.config && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground font-mono">
            window: {status.config.window_minutes}min
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-mono">
            stop-loss: {(status.config.stop_loss_pct * 100).toFixed(0)}%
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-mono">
            surge: {(status.config.surge_threshold_mid * 100).toFixed(0)}–{(status.config.surge_threshold_high * 100).toFixed(0)}%
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            deploy: {(status.config.normal_position_pct * 100).toFixed(0)}–{(status.config.strong_position_pct * 100).toFixed(0)}% equity
          </span>
        </div>
      )}

      {/* ── Coin rows ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 px-4 py-3">
        {isLoading && !hasStatus ? (
          <div className="col-span-4 flex items-center justify-center h-16 text-muted-foreground text-xs">
            Connecting to scanner…
          </div>
        ) : error ? (
          <div className="col-span-4 flex items-center justify-center h-16 text-red-400 text-xs font-mono">
            {error}
          </div>
        ) : (
          watchedSyms.map((sym) => {
            const data: SymbolSurgeStatus = surgeStatus[sym] ?? {
              type: 'WATCHING',
              pct_change: 0,
              at: 0,
            };
            return <SymbolRow key={sym} symbol={sym} data={data} />;
          })
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-2.5 border-t border-border flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
        <ShieldCheck className="w-3 h-3 text-emerald-500" />
        Guardian-gated · Paper mode only · Top market-cap coins
        {soundEnabled && (
          <span className="ml-auto flex items-center gap-1 text-emerald-400">
            <Volume2 className="w-2.5 h-2.5" /> alerts on
          </span>
        )}
      </div>
    </div>
  );
}
