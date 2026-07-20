import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public certification access', () => {
  it('keeps the overview public and validates its same-origin diagnostics', async () => {
    const [
      app,
      home,
      overview,
      dashboardEntry,
      statusClient,
      statusEndpoint,
      healthClient,
      healthEndpoint,
      vercel,
    ] = await Promise.all([
      readFile(new URL('../AppCore.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/PublicHome.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/CertificationOverview.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/DashboardEntry.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../lib/certificationStatusApi.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../api/certification/status.js', import.meta.url), 'utf8'),
      readFile(new URL('../lib/certificationBackendHealthApi.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../api/certification/backend-health.js', import.meta.url), 'utf8'),
      readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
    ]);

    expect(app).toContain('const CertificationOverview = lazy');
    expect(app).toContain('<Route path="/certification" element={<CertificationOverview />} />');
    expect(app).not.toMatch(/path="\/certification"[\s\S]{0,160}<ProtectedPage>/);

    expect(home).toContain('to="/certification"');
    expect(home).toContain('Open certification overview');
    expect(home).not.toContain('to="/dashboard"');

    expect(overview).toContain('This page is intentionally independent of sign-in and connected-dashboard availability.');
    expect(overview).toContain('What has been built');
    expect(overview).toContain('What still remains');
    expect(overview).toContain('/operator-readiness');
    expect(overview).toContain('/api/certification/status');
    expect(overview).toContain('/api/certification/backend-health');
    expect(overview).toContain('static fallback');
    expect(overview).toContain('All operational capabilities locked');
    expect(overview).toContain('No body read; zero retries');
    expect(overview).toContain('checking from Vercel');
    expect(overview).not.toContain('readOperatorReadinessSnapshot');
    expect(overview).not.toContain('fetchBackendJson');
    expect(overview).not.toContain('useAuth');

    expect(statusClient).toContain("CERTIFICATION_STATUS_ROUTE = '/api/certification/status'");
    expect(statusClient).toContain("method: 'GET'");
    expect(statusClient).toContain("credentials: 'omit'");
    expect(statusClient).toContain("redirect: 'error'");
    expect(statusClient).toContain("cache: 'no-store'");
    expect(statusClient).toContain('capabilities[key] !== false');
    expect(statusClient).not.toContain("credentials: 'include'");

    expect(statusEndpoint).toContain("schemaVersion: 'certification-status.v1'");
    expect(statusEndpoint).toContain("mode: 'CERTIFICATION'");
    expect(statusEndpoint).toContain('readOnly: true');
    expect(statusEndpoint).toContain('deploymentAllowed: false');
    expect(statusEndpoint).toContain('executionAllowed: false');
    expect(statusEndpoint).toContain('mainnetAllowed: false');
    expect(statusEndpoint).toContain('withdrawalsAllowed: false');
    expect(statusEndpoint).not.toMatch(/\bfetch\s*\(/i);
    expect(statusEndpoint).not.toMatch(/authorization/i);
    expect(statusEndpoint).not.toMatch(/deploymentAllowed:\s*true/i);
    expect(statusEndpoint).not.toMatch(/executionAllowed:\s*true/i);

    expect(healthClient).toContain("CERTIFICATION_BACKEND_HEALTH_ROUTE = '/api/certification/backend-health'");
    expect(healthClient).toContain("method: 'GET'");
    expect(healthClient).toContain("credentials: 'omit'");
    expect(healthClient).toContain("redirect: 'error'");
    expect(healthClient).toContain('value.responseBodyRead !== false');
    expect(healthClient).toContain('value.retriesAttempted !== 0');

    expect(healthEndpoint).toContain("DEFAULT_BACKEND_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev'");
    expect(healthEndpoint).toContain("url.hostname.endsWith('.workers.dev')");
    expect(healthEndpoint).toContain("url.pathname = '/health'");
    expect(healthEndpoint).toContain('HEALTH_TIMEOUT_MS = 4_000');
    expect(healthEndpoint).toContain('await fetch(target.url');
    expect(healthEndpoint).toContain('responseBodyRead: false');
    expect(healthEndpoint).toContain('retriesAttempted: 0');
    expect(healthEndpoint).not.toContain('upstream.json(');
    expect(healthEndpoint).not.toContain('upstream.text(');
    expect(healthEndpoint).not.toMatch(/request\.body/i);
    expect(healthEndpoint).not.toMatch(/authorization/i);

    expect(vercel).toContain('(?!api/|assets/|.*\\..*)');

    expect(app).toContain("const DashboardEntry = lazy(() => import('./pages/DashboardEntry'))");
    expect(app).toMatch(/path="\/dashboard"[\s\S]{0,180}<ProtectedPage>[\s\S]{0,120}<DashboardEntry \/>/);
    expect(dashboardEntry).toContain("const ConnectedDashboard = lazy(() => import('./Index'))");
    expect(dashboardEntry).toContain('const HEALTH_TIMEOUT_MS = 5_000');
    expect(dashboardEntry).toContain('const DIAGNOSTIC_TIMEOUT_MS = 6_000');
    expect(dashboardEntry).toContain('fetchCertificationBackendHealth(controller.signal)');
    expect(dashboardEntry).toContain("reason: 'browser-network-path'");
    expect(dashboardEntry).toContain('The Vercel application and Worker are healthy');
    expect(dashboardEntry).toContain('The connected dashboard remains closed');
    expect(dashboardEntry).toContain("method: 'GET'");
    expect(dashboardEntry).toContain("credentials: 'omit'");
    expect(dashboardEntry).toContain("redirect: 'error'");
    expect(dashboardEntry).toContain('PAPER_DASHBOARD_ROUTES.health');
    expect(dashboardEntry).toContain('to="/certification"');
    expect(dashboardEntry).toContain('Retry browser and server checks');
    expect(dashboardEntry).toMatch(/if \(result\.healthy\)[\s\S]{0,420}reason: 'browser-network-path'/);
    expect(dashboardEntry).not.toMatch(/if \(result\.healthy\)[\s\S]{0,900}status: 'available'/);
  });
});
