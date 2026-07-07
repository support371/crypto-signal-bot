import { readFileSync } from "node:fs";

const productionConfig = readFileSync(
  new URL("../../wrangler.production.toml", import.meta.url),
  "utf8",
);
const productionEntrypoint = readFileSync(
  new URL("../src/index_production.ts", import.meta.url),
  "utf8",
);
const coreWorker = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);

const checks = [
  ["production entrypoint selected", /main\s*=\s*"worker\/src\/index_production\.ts"/, productionConfig],
  ["TRADING_MODE paper", /TRADING_MODE\s*=\s*"paper"/, productionConfig],
  ["EXCHANGE_MODE paper", /EXCHANGE_MODE\s*=\s*"paper"/, productionConfig],
  ["NETWORK testnet", /NETWORK\s*=\s*"testnet"/, productionConfig],
  ["ALLOW_MAINNET false", /ALLOW_MAINNET\s*=\s*"false"/, productionConfig],
  ["exact CORS origin", /CORS_ALLOWED_ORIGINS\s*=\s*"https:\/\/crypto-signal-bot-indol\.vercel\.app"/, productionConfig],
  ["fail-closed missing-key response", /OPERATOR_AUTH_NOT_CONFIGURED[\s\S]*503/, productionEntrypoint],
  ["sensitive memory reads protected", /SENSITIVE_READ_PREFIXES\s*=\s*\['\/agent\/memory\/'\]/, productionEntrypoint],
  ["live route remains blocked", /\/intent\/live[\s\S]*403/, coreWorker],
  ["withdraw route remains blocked", /\/withdraw[\s\S]*403/, coreWorker],
  ["live order route remains blocked", /\/live\/order[\s\S]*403/, coreWorker],
  ["live trade route remains blocked", /\/live\/trade[\s\S]*403/, coreWorker],
];

const failures = checks.filter(([, pattern, content]) => !pattern.test(content));

if (failures.length > 0) {
  for (const [name] of failures) {
    console.error(`Production safety check failed: ${name}`);
  }
  process.exit(1);
}

console.log("Cloudflare production safety checks passed.");
