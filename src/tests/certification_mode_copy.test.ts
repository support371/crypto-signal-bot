import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const productFiles = [
  '../../index.html',
  '../pages/Index.tsx',
  '../pages/Infrastructure.tsx',
  '../pages/Auth.tsx',
  '../pages/PublicHome.tsx',
  '../pages/PrivacyPolicy.tsx',
  '../components/Header.tsx',
  '../components/SetupRequiredScreen.tsx',
  '../components/Sidebar.tsx',
  '../components/dashboard/Header.tsx',
  '../components/dashboard/PortfolioPanel.tsx',
  '../components/dashboard/CommandConsolePanel.tsx',
  '../components/dashboard/EarningsPanel.tsx',
  '../components/dashboard/GuardianPanel.tsx',
  '../components/dashboard/SurgePanel.tsx',
  '../../public/privacy/index.html',
] as const;

describe('Certification Mode product language', () => {
  it('uses certification language without weakening compatibility safety locks', async () => {
    const sources = await Promise.all(
      productFiles.map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
    );
    const productSurface = sources.join('\n');

    for (const required of [
      'CERTIFICATION MODE',
      'Certification Trading Terminal',
      'Certification Portfolio',
      'Certification Mode and Exchange Safety',
      'Certification Mode Dashboard',
      'provider mutation and funds movement remain locked',
    ]) {
      expect(productSurface).toContain(required);
    }

    for (const retired of [
      'DEMO PAPER MODE',
      'Paper Trading Control Center',
      'Paper Portfolio',
      'Paper Trading Mode',
      'Paper mode only',
      'paper balance are offline',
      'AUTO-TRADE PAPER ON',
    ]) {
      expect(productSurface).not.toContain(retired);
    }

    expect(productSurface).toContain("fetchBackendJson('/intent/paper'");
    expect(productSurface).toContain("systemMode = 'paper'");
    expect(productSurface).toContain('live execution is disabled');
    expect(productSurface).toContain('/withdraw route must remain HTTP 403');
  });
});
