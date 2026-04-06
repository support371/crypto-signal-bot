import { useMemo } from 'react';
import { History, ShieldAlert, ArrowUpDown, ReceiptText, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AuditIntent, AuditOrder, AuditRiskEvent, AuditTrail, AuditWithdrawal } from '@/hooks/useAuditTrail';

type AuditEvent =
  | {
      id: string;
      kind: 'intent';
      timestamp: number;
      title: string;
      detail: string;
      accent: string;
      status: string;
    }
  | {
      id: string;
      kind: 'order';
      timestamp: number;
      title: string;
      detail: string;
      accent: string;
      status: string;
    }
  | {
      id: string;
      kind: 'risk';
      timestamp: number;
      title: string;
      detail: string;
      accent: string;
      status: string;
    }
  | {
      id: string;
      kind: 'withdrawal';
      timestamp: number;
      title: string;
      detail: string;
      accent: string;
      status: string;
    };

interface AuditTrailPanelProps {
  audit: AuditTrail | null;
  isLoading?: boolean;
  onRefetch?: () => void;
}

function eventTimeLabel(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeIntent(intent: AuditIntent): AuditEvent {
  return {
    id: `intent-${intent.id}`,
    kind: 'intent',
    timestamp: intent.updated_at ?? intent.created_at ?? 0,
    title: `${intent.side} ${intent.symbol}`,
    detail: intent.notes || `${intent.mode ?? 'paper'} intent`,
    accent: intent.side === 'BUY' ? 'text-accent' : 'text-destructive',
    status: intent.status,
  };
}

function normalizeOrder(order: AuditOrder): AuditEvent {
  const fillLabel =
    typeof order.fill_price === 'number' && order.fill_price > 0
      ? `fill ${order.fill_price.toFixed(order.fill_price < 1 ? 6 : 2)}`
      : 'no fill';

  return {
    id: `order-${order.id}`,
    kind: 'order',
    timestamp: order.updated_at ?? order.created_at ?? 0,
    title: `${order.side} ${order.symbol}`,
    detail: fillLabel,
    accent: order.side === 'BUY' ? 'text-accent' : 'text-destructive',
    status: order.status,
  };
}

function normalizeRiskEvent(event: AuditRiskEvent, index: number): AuditEvent {
  return {
    id: `risk-${event.intent_id ?? index}`,
    kind: 'risk',
    timestamp: event.timestamp ?? 0,
    title: 'Risk Event',
    detail: event.reason || `Risk score ${event.risk_score ?? 'n/a'}`,
    accent: 'text-warning',
    status: event.risk_score != null ? `RISK ${Math.round(event.risk_score)}` : 'RISK',
  };
}

function normalizeWithdrawal(withdrawal: AuditWithdrawal, index: number): AuditEvent {
  return {
    id: `withdrawal-${withdrawal.timestamp}-${index}`,
    kind: 'withdrawal',
    timestamp: withdrawal.timestamp ?? 0,
    title: `Withdraw ${withdrawal.asset}`,
    detail: `${withdrawal.amount} ${withdrawal.asset}`,
    accent: 'text-primary',
    status: 'WITHDRAW',
  };
}

function statusTone(status: string): string {
  if (status.includes('FILLED')) return 'text-accent';
  if (status.includes('FAILED') || status.includes('REJECTED')) return 'text-destructive';
  if (status.includes('RISK')) return 'text-warning';
  return 'text-muted-foreground';
}

function eventIcon(kind: AuditEvent['kind']) {
  switch (kind) {
    case 'intent':
      return ReceiptText;
    case 'order':
      return ArrowUpDown;
    case 'risk':
      return ShieldAlert;
    case 'withdrawal':
      return Download;
  }
}

export function AuditTrailPanel({ audit, isLoading, onRefetch }: AuditTrailPanelProps) {
  const events = useMemo(() => {
    if (!audit) return [];

    return [
      ...audit.intents.map(normalizeIntent),
      ...audit.orders.map(normalizeOrder),
      ...audit.risk_events.map(normalizeRiskEvent),
      ...audit.withdrawals.map(normalizeWithdrawal),
    ]
      .filter((event) => event.timestamp > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  }, [audit]);

  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-40 bg-muted rounded mb-4" />
        <div className="h-28 bg-muted rounded" />
      </div>
    );
  }

  const intentCount = audit?.intents.length ?? 0;
  const orderCount = audit?.orders.length ?? 0;
  const riskCount = audit?.risk_events.length ?? 0;
  const withdrawalCount = audit?.withdrawals.length ?? 0;

  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-secondary" />
          <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-secondary">
            Audit Trail
          </h3>
        </div>
        {onRefetch && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onRefetch}
            title="Refresh audit trail"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg bg-muted/30 px-2 py-2 text-center">
          <div className="text-sm font-mono font-semibold">{intentCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Intents</div>
        </div>
        <div className="rounded-lg bg-muted/30 px-2 py-2 text-center">
          <div className="text-sm font-mono font-semibold">{orderCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Orders</div>
        </div>
        <div className="rounded-lg bg-muted/30 px-2 py-2 text-center">
          <div className="text-sm font-mono font-semibold">{riskCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk</div>
        </div>
        <div className="rounded-lg bg-muted/30 px-2 py-2 text-center">
          <div className="text-sm font-mono font-semibold">{withdrawalCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Withdraw</div>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No audit events recorded yet</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {events.map((event) => {
            const Icon = eventIcon(event.kind);
            return (
              <div
                key={event.id}
                className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className={cn('w-3.5 h-3.5 shrink-0', event.accent)} />
                      <span className={cn('text-xs font-mono font-semibold', event.accent)}>
                        {event.title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed break-words">
                      {event.detail}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('text-[10px] font-mono font-semibold', statusTone(event.status))}>
                      {event.status}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70">
                      {eventTimeLabel(event.timestamp)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
