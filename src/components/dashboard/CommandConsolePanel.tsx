// src/components/dashboard/CommandConsolePanel.tsx
import { useState } from 'react';
import {
  Terminal, Zap, ShieldOff, Shield, RefreshCw,
  ArrowUpCircle, ArrowDownCircle, AlertTriangle, CheckCircle2,
  RotateCcw, Unlock, X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { ConsoleStatus, TradeResult } from '@/hooks/useConsole';

interface CommandConsolePanelProps {
  status: ConsoleStatus | null;
  isLoading?: boolean;
  onSubmitTrade: (params: {
    symbol: string; side: 'BUY' | 'SELL'; quantity: string; force?: boolean;
  }) => Promise<TradeResult>;
  onToggleKillSwitch: (activate: boolean, reason?: string) => Promise<void>;
  onSetSignalOverride: (symbol: string, ttlSeconds?: number) => Promise<unknown>;
  onCancelSignalOverride: (symbol: string) => Promise<unknown>;
  onReEvalSignals: (symbol?: string) => Promise<unknown>;
  onResetGuardian: () => Promise<unknown>;
  onResetPortfolio: () => Promise<unknown>;
  onRefetch: () => void;
}

type ActiveAction = 'trade' | 'override' | null;

export function CommandConsolePanel({
  status,
  isLoading,
  onSubmitTrade,
  onToggleKillSwitch,
  onSetSignalOverride,
  onCancelSignalOverride,
  onReEvalSignals,
  onResetGuardian,
  onResetPortfolio,
  onRefetch,
}: CommandConsolePanelProps) {
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [busy, setBusy] = useState(false);

  // Trade form
  const [tradeSymbol, setTradeSymbol] = useState('BTCUSDT');
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeQty, setTradeQty] = useState('0.001');
  const [tradeForce, setTradeForce] = useState(false);

  // Override form
  const [overrideSymbol, setOverrideSymbol] = useState('BTCUSDT');
  const [overrideTtl, setOverrideTtl] = useState('300');

  const killSwitchActive = status?.guardian?.kill_switch_active ?? false;

  async function handleTrade() {
    if (!tradeQty || !tradeSymbol) return;
    setBusy(true);
    try {
      const result = await onSubmitTrade({
        symbol: tradeSymbol.toUpperCase(),
        side: tradeSide,
        quantity: tradeQty,
        force: tradeForce,
      });
      toast.success(
        `Order ${result.status} — ${result.filled_qty ?? '?'} @ ${result.fill_price ?? '?'}` +
        (result.signal_gate_bypassed ? ' (gate bypassed)' : ''),
        { duration: 5000 }
      );
      setActiveAction(null);
      onRefetch();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Trade failed';
      toast.error(msg, { duration: 6000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleKillSwitch() {
    setBusy(true);
    try {
      await onToggleKillSwitch(!killSwitchActive, killSwitchActive ? undefined : 'Manual console toggle');
      toast.success(killSwitchActive ? 'Kill switch deactivated' : 'Kill switch ACTIVATED', {
        duration: 4000,
      });
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? 'Kill switch action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetOverride() {
    if (!overrideSymbol) return;
    setBusy(true);
    try {
      await onSetSignalOverride(overrideSymbol.toUpperCase(), Number(overrideTtl) || 300);
      toast.success(`Signal gate override set for ${overrideSymbol.toUpperCase()} (${overrideTtl}s)`);
      setActiveAction(null);
      onRefetch();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? 'Override failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleReEval(symbol?: string) {
    setBusy(true);
    try {
      await onReEvalSignals(symbol);
      toast.success(symbol ? `Signals re-evaluated for ${symbol}` : 'All signals re-evaluated');
      onRefetch();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? 'Re-eval failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetGuardian() {
    if (!window.confirm('Reset guardian error counters? This cannot be undone.')) return;
    setBusy(true);
    try {
      await onResetGuardian();
      toast.success('Guardian counters reset');
      onRefetch();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cyber-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-accent" />
          <span className="text-sm font-mono font-semibold tracking-wide text-foreground">
            COMMAND CONSOLE
          </span>
          {killSwitchActive && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 animate-pulse">
              HALTED
            </Badge>
          )}
        </div>
        <Button
          variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={onRefetch} disabled={isLoading}
        >
          <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Status strip */}
      {status && (
        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
          <div className="bg-muted/30 rounded px-2 py-1 text-center">
            <div className="text-muted-foreground">EQUITY</div>
            <div className="text-accent font-semibold">
              ${status.portfolio.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-muted/30 rounded px-2 py-1 text-center">
            <div className="text-muted-foreground">DRAWDOWN</div>
            <div className={cn('font-semibold', status.portfolio.drawdown_pct > 3 ? 'text-destructive' : 'text-foreground')}>
              {status.portfolio.drawdown_pct.toFixed(2)}%
            </div>
          </div>
          <div className="bg-muted/30 rounded px-2 py-1 text-center">
            <div className="text-muted-foreground">SIGNALS</div>
            <div className="text-foreground font-semibold">{status.signals.symbols.length}</div>
          </div>
        </div>
      )}

      {/* Quick-action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={killSwitchActive ? 'default' : 'destructive'}
          size="sm"
          className={cn(
            'h-8 text-xs font-mono',
            killSwitchActive && 'bg-accent hover:bg-accent/80 text-black'
          )}
          onClick={handleKillSwitch}
          disabled={busy}
        >
          {killSwitchActive ? (
            <><Shield className="w-3.5 h-3.5 mr-1.5" />RESUME</>
          ) : (
            <><ShieldOff className="w-3.5 h-3.5 mr-1.5" />KILL SWITCH</>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-mono border-accent/40 text-accent hover:bg-accent/10"
          onClick={() => setActiveAction(activeAction === 'trade' ? null : 'trade')}
          disabled={busy}
        >
          <Zap className="w-3.5 h-3.5 mr-1.5" />
          MANUAL TRADE
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-mono"
          onClick={() => setActiveAction(activeAction === 'override' ? null : 'override')}
          disabled={busy}
        >
          <Unlock className="w-3.5 h-3.5 mr-1.5" />
          GATE OVERRIDE
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-mono"
          onClick={() => handleReEval()}
          disabled={busy}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          RE-EVAL ALL
        </Button>
      </div>

      {/* Inline trade form */}
      {activeAction === 'trade' && (
        <div className="border border-accent/30 rounded p-3 space-y-2 bg-accent/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono text-accent font-semibold">MANUAL ORDER</span>
            <button onClick={() => setActiveAction(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              value={tradeSymbol}
              onChange={e => setTradeSymbol(e.target.value.toUpperCase())}
              placeholder="BTCUSDT"
              className="h-7 text-xs font-mono flex-1"
            />
            <div className="flex rounded overflow-hidden border border-border">
              <button
                onClick={() => setTradeSide('BUY')}
                className={cn(
                  'px-3 text-xs font-mono transition-colors',
                  tradeSide === 'BUY' ? 'bg-accent text-black' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                BUY
              </button>
              <button
                onClick={() => setTradeSide('SELL')}
                className={cn(
                  'px-3 text-xs font-mono transition-colors',
                  tradeSide === 'SELL' ? 'bg-destructive text-white' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                SELL
              </button>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={tradeQty}
              onChange={e => setTradeQty(e.target.value)}
              placeholder="0.001"
              type="number"
              min="0"
              step="0.001"
              className="h-7 text-xs font-mono flex-1"
            />
            <label className="flex items-center gap-1.5 text-xs font-mono text-amber-400 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={tradeForce}
                onChange={e => setTradeForce(e.target.checked)}
                className="accent-amber-400"
              />
              FORCE
            </label>
          </div>
          {tradeForce && (
            <p className="text-[10px] font-mono text-amber-400">
              ⚠ Force bypasses signal gate check
            </p>
          )}
          <Button
            size="sm"
            className={cn(
              'w-full h-7 text-xs font-mono',
              tradeSide === 'BUY'
                ? 'bg-accent hover:bg-accent/80 text-black'
                : 'bg-destructive hover:bg-destructive/80 text-white'
            )}
            onClick={handleTrade}
            disabled={busy || !tradeQty || !tradeSymbol}
          >
            {tradeSide === 'BUY'
              ? <><ArrowUpCircle className="w-3.5 h-3.5 mr-1.5" />SUBMIT BUY</>
              : <><ArrowDownCircle className="w-3.5 h-3.5 mr-1.5" />SUBMIT SELL</>
            }
          </Button>
        </div>
      )}

      {/* Inline override form */}
      {activeAction === 'override' && (
        <div className="border border-amber-500/30 rounded p-3 space-y-2 bg-amber-500/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono text-amber-400 font-semibold">SIGNAL GATE OVERRIDE</span>
            <button onClick={() => setActiveAction(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              value={overrideSymbol}
              onChange={e => setOverrideSymbol(e.target.value.toUpperCase())}
              placeholder="BTCUSDT"
              className="h-7 text-xs font-mono flex-1"
            />
            <Input
              value={overrideTtl}
              onChange={e => setOverrideTtl(e.target.value)}
              placeholder="300"
              type="number"
              className="h-7 text-xs font-mono w-20"
              title="TTL (seconds)"
            />
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">
            Allows one trade against the signal direction within TTL window
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-7 text-xs font-mono border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              onClick={handleSetOverride}
              disabled={busy}
            >
              <Unlock className="w-3 h-3 mr-1" />SET
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 h-7 text-xs font-mono"
              onClick={async () => {
                setBusy(true);
                try {
                  await onCancelSignalOverride(overrideSymbol.toUpperCase());
                  toast.success(`Override cancelled for ${overrideSymbol.toUpperCase()}`);
                  setActiveAction(null);
                  onRefetch();
                } catch { /* ignore */ } finally { setBusy(false); }
              }}
              disabled={busy}
            >
              <X className="w-3 h-3 mr-1" />CANCEL
            </Button>
          </div>
        </div>
      )}

      {/* Active signal overrides */}
      {status && Object.keys(status.signals.overrides).length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-amber-400 uppercase">Active Overrides</p>
          {Object.entries(status.signals.overrides).map(([sym, exp]) => (
            <div key={sym} className="flex items-center justify-between text-[10px] font-mono bg-amber-500/10 rounded px-2 py-1">
              <span className="text-amber-300">{sym}</span>
              <span className="text-muted-foreground">
                expires {new Date(exp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                onClick={async () => {
                  await onCancelSignalOverride(sym);
                  onRefetch();
                }}
                className="text-destructive hover:text-destructive/80 ml-2"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Current signals */}
      {status && status.signals.symbols.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-muted-foreground uppercase">Live Signals</p>
          {status.signals.symbols.map(s => (
            <div
              key={s.symbol}
              className={cn(
                'flex items-center justify-between text-[10px] font-mono rounded px-2 py-1',
                s.side === 'BUY'  ? 'bg-accent/10 border border-accent/20' :
                s.side === 'SELL' ? 'bg-destructive/10 border border-destructive/20' :
                                    'bg-muted/20 border border-border'
              )}
            >
              <span className="text-foreground">{s.symbol}</span>
              <span className={cn(
                'font-bold',
                s.side === 'BUY' ? 'text-accent' : s.side === 'SELL' ? 'text-destructive' : 'text-muted-foreground'
              )}>
                {s.side}
              </span>
              <span className="text-muted-foreground">{(s.confidence * 100).toFixed(0)}%</span>
              <button
                onClick={() => handleReEval(s.symbol)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground ml-1"
                title="Re-evaluate"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer: Guardian + Portfolio reset */}
      <div className="pt-1 border-t border-border space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-muted-foreground">
            {status ? `${status.portfolio.trade_count} trades · ${status.portfolio.win_rate != null ? status.portfolio.win_rate.toFixed(1) : '—'}% WR` : '—'}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] font-mono text-muted-foreground hover:text-amber-400"
              onClick={handleResetGuardian}
              disabled={busy}
              title="Reset guardian error counters only"
            >
              <RotateCcw className="w-3 h-3 mr-1" />RESET GUARDIAN
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] font-mono text-muted-foreground hover:text-destructive"
              onClick={async () => {
                if (!window.confirm('Hard reset paper portfolio to $10,000? All positions and trades will be cleared.')) return;
                setBusy(true);
                try {
                  await onResetPortfolio();
                  toast.success('Portfolio reset to $10,000');
                  onRefetch();
                } catch (err: unknown) {
                  toast.error((err as { message?: string })?.message ?? 'Reset failed');
                } finally { setBusy(false); }
              }}
              disabled={busy}
              title="Hard reset paper portfolio to $10,000"
            >
              <RotateCcw className="w-3 h-3 mr-1" />RESET PORTFOLIO
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
