import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public certification access', () => {
  it('keeps the overview public and validates the same-origin status mirror', async () => {
    const [app, home, overview, dashboardEntry, client, endpoint, vercel] = await Promise.all([
      readFile(new URL('../AppCore.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/PublicHome.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/CertificationOverview.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/DashboardEntry.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../lib/certificationStatusApi.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../api/certification/status.js', import.meta.url), 'utf8'),
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
    expect(overview).toContain('configured, health not assumed');
    expect(overview).toContain('static fallback');
    expect(overview).toContain('All operational capabilities locked');
    expect(overview).not.toContain('readOperatorReadinessSnapshot');
    expect(overview).not.toContain('fetchBackendJson');
    expect(overview).not.toContain('useAuth');

    expect(client).toContain("CERTIFICATION_STATUS_ROUTE = '/api/certification/status'");
    expect(client).toContain("method: 'GET'");
    expect(client).toContain("credentials: 'omit'");
    expect(client).toContain("redirect: 'error'");
    expect(client).toContain("cache: 'no-store'");
    expect(client).toContain('value.capabilities[key] !== false');
    expect(client).not.toContain("credentials: 'include'");

    expect(endpoint).toContain("schemaVersion: 'certification-status.v1'");
    expect(endpoint).toContain("mode: 'CERTIFICATION'");
    expect(endpoint).toContain('readOnly: true');
    expect(endpoint).toContain('deploymentAllowed: false');
    expect(endpoint).toContain('executionAllowed: false');
    expect(endpoint).toContain('mainnetAllowed: false');
    expect(endpoint).toContain('withdrawalsAllowed: false');
    expect(endpoint).not.toMatch(/\bfetch\s*\(/i);
    expect(endpoint).not.toMatch(/authorization/i);
    expect(endpoint).not.toMatch(/deploymentAllowed:\s*true/i);
    expect(endpoint).not.toMatch(/executionAllowed:\s*true/i);

    expect(vercel).toContain('(?!api/|assets/|.*\\..*)');

    expect(app).toContain("const DashboardEntry = lazy(() => import('./pages/DashboardEntry'))");
    expect(app).toMatch(/path="\/dashboard"[\s\S]{0,180}<ProtectedPage>[\s\S]{0,120}<DashboardEntry \/>/);
    expect(dashboardEntry).toContain("const ConnectedDashboard = lazy(() => import('./Index'))");
    expect(dashboardEntry).toContain('const HEALTH_TIMEOUT_MS = 5_000');
    expect(dashboardEntry).toContain("method: 'GET'");
    expect(dashboardEntry).toContain("credentials: 'omit'");
    expect(dashboardEntry).toContain("redirect: 'error'");
    expect(dashboardEntry).toContain('PAPER_DASHBOARD_ROUTES.health');
    expect(dashboardEntry).toContain('to="/certification"');
    expect(dashboardEntry).toContain('Retry backend check');
  });
});
