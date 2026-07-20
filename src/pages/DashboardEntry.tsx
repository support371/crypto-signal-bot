import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfiguredBackendUrl } from '../lib/env';
import { PAPER_DASHBOARD_ROUTES } from '../lib/paperDashboardRoutes';

const ConnectedDashboard = lazy(() => import('./Index'));
const HEALTH_TIMEOUT_MS = 5_000;

type ConnectionState =
  | { status: 'checking'; message: string }
  | { status: 'available'; message: string }
  | { status: 'unavailable'; message: string };

function backendHost(): string {
  try {
    return new URL(getConfiguredBackendUrl()).host;
  } catch {
    return 'not configured';
  }
}

export default function DashboardEntry() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'checking',
    message: 'Checking the Certification Mode backend…',
  });

  const checkBackend = useCallback(async () => {
    setConnection({ status: 'checking', message: 'Checking the Certification Mode backend…' });

    let backendUrl: string;
    try {
      backendUrl = getConfiguredBackendUrl();
    } catch {
      setConnection({
        status: 'unavailable',
        message: 'No dashboard backend is configured for this deployment.',
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      const response = await fetch(`${backendUrl}${PAPER_DASHBOARD_ROUTES.health}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        setConnection({
          status: 'unavailable',
          message: `The dashboard backend returned HTTP ${response.status}.`,
        });
        return;
      }

      setConnection({ status: 'available', message: 'Backend health check passed.' });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      setConnection({
        status: 'unavailable',
        message: timedOut
          ? 'The dashboard backend did not respond within five seconds.'
          : 'The configured dashboard backend could not be reached from this network.',
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void checkBackend();
  }, [checkBackend]);

  if (connection.status === 'available') {
    return (
      <Suspense
        fallback={
          <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
            <p className="text-sm text-muted-foreground">Loading connected dashboard…</p>
          </main>
        }
      >
        <ConnectedDashboard />
      </Suspense>
    );
  }

  return (
    <main className="min-h-screen bg-secondary-50 px-4 py-10 md:px-8">
      <div className="mx-auto max-w-3xl rounded-2xl border border-secondary-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-secondary-900">
            {connection.status === 'checking' ? 'Checking dashboard access' : 'Connected dashboard unavailable'}
          </h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              connection.status === 'checking'
                ? 'bg-secondary-100 text-secondary-700'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {connection.status === 'checking' ? 'checking' : 'read-only fallback'}
          </span>
        </div>

        <p className="mt-4 text-sm leading-6 text-secondary-700">{connection.message}</p>
        <p className="mt-2 break-all font-mono text-xs text-secondary-500">Backend host: {backendHost()}</p>

        {connection.status === 'checking' && (
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-secondary-100">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary-500" />
          </div>
        )}

        {connection.status === 'unavailable' && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            The Vercel application is available. Only the separately hosted connected-dashboard service is unavailable.
            The Certification Overview remains accessible and describes the implemented and remaining work.
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {connection.status === 'unavailable' && (
            <button
              type="button"
              onClick={() => void checkBackend()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              Retry backend check
            </button>
          )}
          <Link
            to="/certification"
            className="rounded-lg border border-secondary-200 bg-white px-4 py-2 text-sm font-semibold text-secondary-700 transition hover:bg-secondary-50"
          >
            Open Certification Overview
          </Link>
          <Link
            to="/"
            className="rounded-lg border border-secondary-200 bg-white px-4 py-2 text-sm font-semibold text-secondary-700 transition hover:bg-secondary-50"
          >
            Public home
          </Link>
        </div>
      </div>
    </main>
  );
}
