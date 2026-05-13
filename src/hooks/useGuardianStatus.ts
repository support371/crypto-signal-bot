import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { GuardianStatus } from '@/components/dashboard/GuardianPanel';

export function useGuardianStatus(pollIntervalMs = 15000) {
  const [guardian, setGuardian] = useState<GuardianStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const data = await fetchBackendJson<GuardianStatus>('/guardian/status');
      setGuardian({
        ...data,
        strategy_kill_switches: data.strategy_kill_switches ?? [],
        venue_kill_switches: data.venue_kill_switches ?? [],
        reconciliation_drift_count: data.reconciliation_drift_count ?? 0,
        reconciliation_drift_active: data.reconciliation_drift_active ?? false,
        reconciliation_drift_reason: data.reconciliation_drift_reason ?? null,
      });
    } catch {
      // Keep last known state on transient errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = window.setInterval(fetch, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetch, pollIntervalMs]);

  return { guardian, isLoading, refetch: fetch };
}
