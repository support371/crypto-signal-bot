import { readFileSync } from 'node:fs';

const files = [
  '../src/index.ts',
  '../src/dashboardRoutes.ts',
  '../src/paperEngine.ts',
  '../src/renderParity.ts',
  '../../wrangler.toml',
];

const source = files
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

const checks = [
  ['GET /healthz', /app\.get\(['"]\/healthz['"]/],
  ['GET /health', /app\.get\(['"]\/health['"]/],
  ['GET /runtime/status', /app\.get\(['"]\/runtime\/status['"]/],
  ['GET /guardian/status', /app\.get\(['"]\/guardian\/status['"]/],
  ['GET /portfolio/summary', /app\.get\(['"]\/portfolio\/summary['"]/],
  ['GET /portfolio/trades', /app\.get\(['"]\/portfolio\/trades['"]/],
  ['GET /signals', /app\.get\(['"]\/signals['"]/],
  ['GET /signals/history', /app\.get\(['"]\/signals\/history['"]/],
  ['POST /signals/generate', /app\.post\(['"]\/signals\/generate['"]/],
  ['GET /dashboard', /app\.get\(['"]\/dashboard['"]/],
  ['GET /market/price/:symbol', /app\.get\(['"]\/market\/price\/:symbol['"]/],
  ['GET /market/feed/status', /app\.get\(['"]\/market\/feed\/status['"]/],
  ['GET /surge/status', /app\.get\(['"]\/surge\/status['"]/],
  ['GET /exchange/circuit-breakers', /app\.get\(['"]\/exchange\/circuit-breakers['"]/],
  ['GET /audit', /app\.get\(['"]\/audit['"]/],
  ['GET /backtest', /app\.get\(['"]\/backtest['"]/],
  ['POST /backtest', /app\.post\(['"]\/backtest['"]/],
  ['POST /intent/paper', /app\.post\(['"]\/intent\/paper['"]/],
  ['POST /guardian/kill', /app\.post\(['"]\/guardian\/kill['"]/],
  ['POST /guardian/reset', /app\.post\(['"]\/guardian\/reset['"]/],
  ['POST /intent/live blocked', /app\.post\(['"]\/intent\/live['"][\s\S]*403/],
  ['POST /withdraw blocked', /app\.post\(['"]\/withdraw['"][\s\S]*403/],
  ['TRADING_MODE paper', /TRADING_MODE\s*=\s*"paper"/],
  ['EXCHANGE_MODE paper', /EXCHANGE_MODE\s*=\s*"paper"/],
  ['ALLOW_MAINNET false', /ALLOW_MAINNET\s*=\s*"false"/],
  ['Coinbase public market data', /api\.coinbase\.com\/v2\/prices/],
];

const failures = checks.filter(([, pattern]) => !pattern.test(source));

if (failures.length > 0) {
  for (const [name] of failures) {
    console.error(`Critical route check failed: ${name}`);
  }
  process.exit(1);
}

console.log('Critical route and paper-safety checks passed.');
