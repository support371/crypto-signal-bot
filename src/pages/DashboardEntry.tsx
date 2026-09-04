import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCertificationBackendHealth } from '../lib/certificationBackendHealthApi';
import { getConfiguredBackendUrl } from '../lib/env';
import { PAPER_DASHBOARD_ROUTES } from '../lib/paperDashboardRoutes';

const ConnectedDashboard = lazy(() => import('./Index'));
const HEALTH_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_TIMEOUT_MS = 6_000;

type UnavailableReason =
  | 'not-configured'
  | 'backend-response'
  | 'browser-network-path'
  | 'backend-unreachable'
  | 'diagnostic-unavailable';

type ConnectionState =
  | { status: 'checking'; message: string }
  | { status: 'available'; message: string }
  | { status: 'unavailable'; message: string; reason: UnavailableReason };

function backendHost(): string {
  try {
    return new URL(getConfiguredBackendUrl()).host;
  } catch {
    return 'not configured';
  }
}

async function classifyBrowserFailure(browserMessage: string): Promise<Extract<ConnectionState, { status: 'unavailable' }>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS);

  try {
    const snapshot = await fetchCertificationBackendHealth(controller.signal);
    const { result, target } = snapshot;

    if (result.healthy) {
      return {
        status: 'unavailable',
        reason: 'browser-network-path',
        message: `${browserMessage} Vercel reached ${target.host} successfully with HTTP ${result.statusCode} in ${result.latencyMs} ms, so the failure is limited to this browser or network path.`,
      };
    }

    if (result.reachable) {
      return {
        status: 'unavailable',
        reason: 'backend-response',
        message: `${browserMessage} Vercel also reached ${target.host}, but its health route returned HTTP ${result.statusCode}.`,
      };
    }

    return {
      status: 'unavailable',
      reason: 'backend-unreachable',
      message: `${browserMessage} Vercel could not reach ${target.host} either; diagnostic state: ${result.state}.`,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return {
      status: 'unavailable',
      reason: 'diagnostic-unavailable',
      message: `${browserMessage} ${
        timedOut
          ? 'The same-origin server diagnostic did not respond within six seconds.'
          : 'The same-origin server diagnostic could not classify the failure.'
      }`,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function fallbackExplanation(reason: UnavailableReason): string {
  if (reason === 'browser-network-path') {
    return 'The Vercel application and Worker are healthy, but this device or mobile network cannot reach the workers.dev route directly. The connected dashboard remains closed because its data requests would fail from this browser.';
  }
  if (reason === 'backend-response' || reason === 'backend-unreachable') {
    return 'The connected-dashboard service did not pass its health requirement. The Vercel application remains available, and the Certification Overview shows the measured backend state.';
  }
  if (reason === 'not-configured') {
    return 'This deployment has no browser-facing dashboard backend configured. The public Certification Overview remains available.';
  }
  return 'The browser check failed and the same-origin diagnostic could not establish the backend condition. The public Certification Overview remains available.';
}

export default function DashboardEntry() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'checking',
    message: 'Checking the Certification Mode backend from this browser…',
  });

  const checkBackend = useCallback(async () => {
    setConnection({ status: 'checking', message: 'Checking the Certification Mode backend from this browser…' });

    let backendUrl: string;
    try {
      backendUrl = getConfiguredBackendUrl();
    } catch {
      setConnection({
        status: 'unavailable',
        reason: 'not-configured',
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
          reason: 'backend-response',
          message: `This browser reached the dashboard backend, but it returned HTTP ${response.status}.`,
        });
        return;
      }

      setConnection({ status: 'available', message: 'Browser-to-backend health check passed.' });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      const browserMessage = timedOut
        ? 'This browser did not receive a backend response within five seconds.'
        : 'This browser could not reach the configured dashboard backend.';
      setConnection(await classifyBrowserFailure(browserMessage));
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
            {connection.status === 'checking' ? 'checking browser path' : 'read-only fallback'}
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
            {fallbackExplanation(connection.reason)}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {connection.status === 'unavailable' && (
            <button
              type="button"
              onClick={() => void checkBackend()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              Retry browser and server checks
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
