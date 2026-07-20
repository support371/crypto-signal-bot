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

    for (const required of [
      'This page is intentionally independent of sign-in and connected-dashboard availability.',
      'What has been built',
      'What still remains',
      '/operator-readiness',
      '/api/certification/status',
      '/api/certification/backend-health',
      'static fallback',
      'All operational capabilities locked',
      'No body read; zero retries',
      'checking from Vercel',
    ]) {
      expect(overview).toContain(required);
    }
    expect(overview).not.toContain('readOperatorReadinessSnapshot');
    expect(overview).not.toContain('fetchBackendJson');
    expect(overview).not.toContain('useAuth');

    for (const client of [statusClient, healthClient]) {
      expect(client).toContain("method: 'GET'");
      expect(client).toContain("credentials: 'omit'");
      expect(client).toContain("redirect: 'error'");
      expect(client).toContain("cache: 'no-store'");
      expect(client).not.toContain("credentials: 'include'");
    }
    expect(statusClient).toContain("CERTIFICATION_STATUS_ROUTE = '/api/certification/status'");
    expect(healthClient).toContain("CERTIFICATION_BACKEND_HEALTH_ROUTE = '/api/certification/backend-health'");
    expect(healthClient).toContain('value.responseBodyRead !== false');
    expect(healthClient).toContain('value.retriesAttempted !== 0');

    for (const required of [
      "schemaVersion: 'certification-status.v1'",
      "mode: 'CERTIFICATION'",
      'readOnly: true',
      'deploymentAllowed: false',
      'executionAllowed: false',
      'mainnetAllowed: false',
      'withdrawalsAllowed: false',
    ]) {
      expect(statusEndpoint).toContain(required);
    }
    expect(statusEndpoint).not.toMatch(/\bfetch\s*\(/i);
    expect(statusEndpoint).not.toMatch(/deploymentAllowed:\s*true/i);
    expect(statusEndpoint).not.toMatch(/executionAllowed:\s*true/i);

    for (const required of [
      "DEFAULT_BACKEND_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev'",
      "url.hostname.endsWith('.workers.dev')",
      "url.pathname = '/health'",
      'HEALTH_TIMEOUT_MS = 4_000',
      'await fetch(target.url',
      'responseBodyRead: false',
      'retriesAttempted: 0',
    ]) {
      expect(healthEndpoint).toContain(required);
    }
    expect(healthEndpoint).not.toContain('upstream.json(');
    expect(healthEndpoint).not.toContain('upstream.text(');
    expect(healthEndpoint).not.toMatch(/request\.body/i);

    expect(vercel).toContain('(?!api/|assets/|.*\\..*)');

    for (const required of [
      "const ConnectedDashboard = lazy(() => import('./Index'))",
      'const HEALTH_TIMEOUT_MS = 5_000',
      'const DIAGNOSTIC_TIMEOUT_MS = 6_000',
      'fetchCertificationBackendHealth(controller.signal)',
      "reason: 'browser-network-path'",
      'The Vercel application and Worker are healthy',
      'The connected dashboard remains closed',
      "method: 'GET'",
      "credentials: 'omit'",
      "redirect: 'error'",
      'PAPER_DASHBOARD_ROUTES.health',
      'to="/certification"',
      'Retry browser and server checks',
    ]) {
      expect(dashboardEntry).toContain(required);
    }

    const classificationStart = dashboardEntry.indexOf('async function classifyBrowserFailure');
    const componentStart = dashboardEntry.indexOf('export default function DashboardEntry');
    const classifier = dashboardEntry.slice(classificationStart, componentStart);
    expect(classificationStart).toBeGreaterThanOrEqual(0);
    expect(componentStart).toBeGreaterThan(classificationStart);
    expect(classifier).toContain("status: 'unavailable'");
    expect(classifier).not.toContain("status: 'available'");

    expect(app).toContain("const DashboardEntry = lazy(() => import('./pages/DashboardEntry'))");
    expect(app).toMatch(/path="\/dashboard"[\s\S]{0,180}<ProtectedPage>[\s\S]{0,120}<DashboardEntry \/>/);
  });
});
