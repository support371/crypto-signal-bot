import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { BackendExchangeStatus } from '@/hooks/useBackendStatus';

export interface UseExchangeStatusResult {
  status: BackendExchangeStatus | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useExchangeStatus(pollIntervalMs = 30000): UseExchangeStatusResult {
  const [status, setStatus] = useState<BackendExchangeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<BackendExchangeStatus>('/exchange/status');
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch exchange status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = window.setInterval(fetchStatus, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

  return { status, error, isLoading, refetch: fetchStatus };
}
