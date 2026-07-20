import { describe, expect, it } from 'vitest';

import { PAPER_DASHBOARD_ROUTES } from '../lib/paperDashboardRoutes';
import { normalizeWorkerSignal } from '../lib/paperSignal';

describe('paper dashboard Worker route contract', () => {
  it('uses the canonical routes exposed by the deployed Cloudflare Worker', () => {
    expect(PAPER_DASHBOARD_ROUTES).toEqual({
      health: '/health',
      runtimeStatus: '/runtime/status',
      exchangeStatus: '/exchange/status',
      portfolioBalance: '/portfolio/balance',
      portfolioSummary: '/portfolio/summary',
      orders: '/orders',
      marketPrices: '/market/prices',
      signalLatest: '/signal/latest',
    });
  });

  it('contains no live, mainnet, transfer, or withdrawal path', () => {
    const routes = Object.values(PAPER_DASHBOARD_ROUTES).join('\n');
    expect(routes).not.toMatch(/live|mainnet|transfer|withdraw/i);
  });
});

describe('paper dashboard signal normalization', () => {
  it('normalizes display evidence without creating risk approval', () => {
    expect(normalizeWorkerSignal({
      symbol: 'BTC',
      side: 'BUY',
      confidence: 0.68,
      available: true,
    }, 'BTC')).toEqual({
      direction: 'UP',
      confidence: 68,
      regime: 'TREND',
      horizon: 60,
    });
  });

  it('rejects unavailable or mismatched signal evidence', () => {
    expect(normalizeWorkerSignal({
      symbol: 'BTC',
      side: 'BUY',
      confidence: 0.68,
      available: false,
    }, 'BTC')).toBeNull();

    expect(normalizeWorkerSignal({
      symbol: 'ETH',
      side: 'BUY',
      confidence: 0.68,
      available: true,
    }, 'BTC')).toBeNull();
  });
});
