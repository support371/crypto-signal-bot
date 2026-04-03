import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { GuardianStatus } from '@/components/dashboard/GuardianPanel';

export function useGuardianStatus(pollIntervalMs = 15000) {
  const [guardian, setGuardian] = useState<GuardianStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const data = await fetchBackendJson<GuardianStatus>('/guardian/status');
      setGuardian(data);
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
