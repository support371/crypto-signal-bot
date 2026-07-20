import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public certification access', () => {
  it('keeps the overview outside the authenticated route wrapper', async () => {
    const [app, home, overview] = await Promise.all([
      readFile(new URL('../AppCore.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/PublicHome.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../pages/CertificationOverview.tsx', import.meta.url), 'utf8'),
    ]);

    expect(app).toContain('const CertificationOverview = lazy');
    expect(app).toContain('<Route path="/certification" element={<CertificationOverview />} />');
    expect(app).not.toMatch(/path="\/certification"[\s\S]{0,160}<ProtectedPage>/);

    expect(home).toContain('to="/certification"');
    expect(home).toContain('Open certification overview');
    expect(home).not.toContain('to="/dashboard"');

    expect(overview).toContain('This page is intentionally independent of sign-in and backend availability.');
    expect(overview).toContain('What has been built');
    expect(overview).toContain('What still remains');
    expect(overview).toContain('/operator-readiness');
    expect(overview).not.toContain('readOperatorReadinessSnapshot');
    expect(overview).not.toContain('fetchBackendJson');
    expect(overview).not.toContain('useAuth');
  });
});
