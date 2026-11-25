import { useState } from 'react';
import { useAuditTrail } from '@/hooks/useAuditTrail';
import { Button } from '@/components/ui/button';
import {
  FileText,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Shield,
  Clock,
} from 'lucide-react';

type TabKey = 'intents' | 'orders' | 'risk';

function formatTs(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts > 10_000_000_000 ? ts : ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function StatusBadge({ status }: { status: string }) {
  const upper = status.toUpperCase();
  const color =
    upper === 'FILLED' || upper === 'COMPLETED' || upper === 'APPROVED'
      ? 'bg-green-400/10 text-green-400'
      : upper === 'REJECTED' || upper === 'FAILED' || upper === 'DENIED'
      ? 'bg-red-400/10 text-red-400'
      : upper === 'PENDING' || upper === 'OPEN'
      ? 'bg-yellow-400/10 text-yellow-400'
      : 'bg-muted text-muted-foreground';
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${color}`}>
      {upper}
    </span>
  );
}

export default function Audit() {
  const { audit, isLoading, refetch } = useAuditTrail(10000);
  const [tab, setTab] = useState<TabKey>('intents');

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'intents', label: 'Intents', count: audit?.intents.length ?? 0 },
    { key: 'orders', label: 'Orders', count: audit?.orders.length ?? 0 },
    { key: 'risk', label: 'Risk Events', count: audit?.risk_events.length ?? 0 },
  ];

  return (
    <main className="min-h-screen bg-background scanlines">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">
                Audit Trail
              </h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Decision traces, order history, and risk events
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="font-mono text-xs"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Refresh
          </Button>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 mb-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded px-3 py-1.5 font-mono text-xs transition ${
                tab === t.key
                  ? 'bg-primary/10 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                ({t.count})
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="cyber-card p-8 text-center">
            <p className="font-mono text-xs text-muted-foreground">Loading audit trail...</p>
          </div>
        ) : (
          <>
            {/* Intents Tab */}
            {tab === 'intents' && (
              <section className="cyber-card p-5">
                {audit && audit.intents.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Time</th>
                          <th className="pb-2 pr-4 font-medium">ID</th>
                          <th className="pb-2 pr-4 font-medium">Symbol</th>
                          <th className="pb-2 pr-4 font-medium">Side</th>
                          <th className="pb-2 pr-4 font-medium">Status</th>
                          <th className="pb-2 pr-4 font-medium">Mode</th>
                          <th className="pb-2 font-medium text-right">Fill Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...audit.intents]
                          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
                          .map((intent) => {
                            const isBuy = intent.side.toUpperCase() === 'BUY';
                            return (
                              <tr key={intent.id} className="border-b border-border/30 text-xs">
                                <td className="py-2 pr-4 font-mono text-muted-foreground whitespace-nowrap">
                                  {formatTs(intent.created_at)}
                                </td>
                                <td className="py-2 pr-4 font-mono text-muted-foreground">
                                  {intent.id.slice(0, 8)}...
                                </td>
                                <td className="py-2 pr-4 font-mono font-semibold text-foreground">
                                  {intent.symbol}
                                </td>
                                <td className="py-2 pr-4">
                                  <span
                                    className={`flex items-center gap-1 font-mono font-semibold ${
                                      isBuy ? 'text-green-400' : 'text-red-400'
                                    }`}
                                  >
                                    {isBuy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {intent.side.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-2 pr-4">
                                  <StatusBadge status={intent.status} />
                                </td>
                                <td className="py-2 pr-4 font-mono text-muted-foreground">
                                  {intent.mode ?? '—'}
                                </td>
                                <td className="py-2 text-right font-mono text-foreground">
                                  {intent.fill_price != null
                                    ? `$${Number(intent.fill_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={FileText} message="No execution intents recorded yet" />
                )}
              </section>
            )}

            {/* Orders Tab */}
            {tab === 'orders' && (
              <section className="cyber-card p-5">
                {audit && audit.orders.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Time</th>
                          <th className="pb-2 pr-4 font-medium">ID</th>
                          <th className="pb-2 pr-4 font-medium">Symbol</th>
                          <th className="pb-2 pr-4 font-medium">Side</th>
                          <th className="pb-2 pr-4 font-medium text-right">Quantity</th>
                          <th className="pb-2 pr-4 font-medium text-right">Fill Price</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...audit.orders]
                          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
                          .map((order) => {
                            const isBuy = order.side.toUpperCase() === 'BUY';
                            return (
                              <tr key={order.id} className="border-b border-border/30 text-xs">
                                <td className="py-2 pr-4 font-mono text-muted-foreground whitespace-nowrap">
                                  {formatTs(order.created_at)}
                                </td>
                                <td className="py-2 pr-4 font-mono text-muted-foreground">
                                  {order.id.slice(0, 8)}...
                                </td>
                                <td className="py-2 pr-4 font-mono font-semibold text-foreground">
                                  {order.symbol}
                                </td>
                                <td className="py-2 pr-4">
                                  <span
                                    className={`flex items-center gap-1 font-mono font-semibold ${
                                      isBuy ? 'text-green-400' : 'text-red-400'
                                    }`}
                                  >
                                    {isBuy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {order.side.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-2 pr-4 text-right font-mono text-foreground">
                                  {order.quantity != null
                                    ? Number(order.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })
                                    : '—'}
                                </td>
                                <td className="py-2 pr-4 text-right font-mono text-foreground">
                                  {order.fill_price != null
                                    ? `$${Number(order.fill_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'}
                                </td>
                                <td className="py-2">
                                  <StatusBadge status={order.status} />
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={Clock} message="No orders recorded yet" />
                )}
              </section>
            )}

            {/* Risk Events Tab */}
            {tab === 'risk' && (
              <section className="cyber-card p-5">
                {audit && audit.risk_events.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Time</th>
                          <th className="pb-2 pr-4 font-medium">Intent</th>
                          <th className="pb-2 pr-4 font-medium text-right">Risk Score</th>
                          <th className="pb-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...audit.risk_events]
                          .sort((a, b) => b.timestamp - a.timestamp)
                          .map((event, i) => (
                            <tr key={i} className="border-b border-border/30 text-xs">
                              <td className="py-2 pr-4 font-mono text-muted-foreground whitespace-nowrap">
                                {formatTs(event.timestamp)}
                              </td>
                              <td className="py-2 pr-4 font-mono text-muted-foreground">
                                {event.intent_id ? `${event.intent_id.slice(0, 8)}...` : '—'}
                              </td>
                              <td className="py-2 pr-4 text-right">
                                {event.risk_score != null ? (
                                  <span
                                    className={`font-mono font-semibold ${
                                      event.risk_score > 0.7
                                        ? 'text-red-400'
                                        : event.risk_score > 0.4
                                        ? 'text-yellow-400'
                                        : 'text-green-400'
                                    }`}
                                  >
                                    {(event.risk_score * 100).toFixed(0)}%
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-2 font-mono text-foreground">
                                {event.reason ?? '—'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={Shield} message="No risk events recorded yet" />
                )}
              </section>
            )}
          </>
        )}

        <p className="mt-6 text-center font-mono text-[10px] text-muted-foreground/60">
          PAPER MODE — All audit entries are from simulated paper trading
        </p>
      </div>
    </main>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
}) {
  return (
    <div className="py-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="font-mono text-sm text-muted-foreground">{message}</p>
      <p className="font-mono text-xs text-muted-foreground/60 mt-1">
        Execute paper trades to generate audit entries.
      </p>
    </div>
  );
}
