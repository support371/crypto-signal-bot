// src/hooks/useMonitoring.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface ProbeEntry {
  ok: boolean | null;
  latency_ms: number | null;
  consecutive_failures: number;
  error: string | null;
  detail: Record<string, unknown>;
  ts: number | null;
  alerted: boolean;
}

export interface MonitorStatus {
  running: boolean;
  last_run_at: number;
  run_count: number;
  probe_interval: number;
  overall_ok: boolean;
  probes: Record<string, ProbeEntry>;
}

export function useMonitoring(pollIntervalMs = 30_000) {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      const data = await fetchBackendJson<MonitorStatus>('/api/v1/monitor/status');
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch monitor status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runNow = useCallback(async () => {
    try {
      await fetchBackendJson('/api/v1/monitor/run', { method: 'POST' });
      await fetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe run failed');
    }
  }, [fetch]);

  useEffect(() => {
    fetch();
    const id = window.setInterval(fetch, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetch, pollIntervalMs]);

  return { status, isLoading, error, refetch: fetch, runNow };
}
