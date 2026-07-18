/**
 * Canonical routes exposed by the deployed Cloudflare paper Worker.
 *
 * Keep this map read-only and free of live, mainnet, or withdrawal paths.
 */
export const PAPER_DASHBOARD_ROUTES = Object.freeze({
  health: '/health',
  runtimeStatus: '/runtime/status',
  exchangeStatus: '/exchange/status',
  portfolioBalance: '/portfolio/balance',
  portfolioSummary: '/portfolio/summary',
  orders: '/orders',
  marketPrices: '/market/prices',
  signalLatest: '/signal/latest',
});
