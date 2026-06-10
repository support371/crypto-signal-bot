/**
 * /health — public system health page.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/apiClient";
import { getBackendBaseUrl } from "@/lib/apiClient";

interface HealthData {
  status?: string;
  mode?: string;
  network?: string;
  runtime?: string;
  uptime_seconds?: number;
  kill_switch_active?: boolean;
  market_data_mode?: string;
}

export default function HealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<HealthData>("/health");
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unreachable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const ok = health?.status === "ok" || health?.status === "healthy";

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-mono">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">System Health</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking backend...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-6">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <XCircle className="h-5 w-5" />
            <span className="font-semibold">Backend Unreachable</span>
          </div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground/50 mt-2">{getBackendBaseUrl()}</p>
        </div>
      )}

      {!loading && health && (
        <div className="space-y-4">
          <div className={`rounded-lg border p-6 ${ok ? "border-green-800 bg-green-950/20" : "border-amber-800 bg-amber-950/20"}`}>
            <div className={`flex items-center gap-2 font-semibold mb-4 ${ok ? "text-green-400" : "text-amber-400"}`}>
              {ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              Status: {health.status?.toUpperCase() ?? "UNKNOWN"}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Mode", health.mode],
                ["Network", health.network],
                ["Runtime", health.runtime],
                ["Uptime", health.uptime_seconds != null ? `${Math.floor(health.uptime_seconds / 60)}m` : "—"],
                ["Market Data", health.market_data_mode],
                ["Kill Switch", health.kill_switch_active ? "ACTIVE 🛑" : "Clear ✓"],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-foreground font-medium">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </main>
  );
}
