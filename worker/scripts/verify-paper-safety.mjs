import { readFileSync } from "node:fs";

const files = [
  "../../wrangler.toml",
  "../src/index.ts",
];

const checks = [
  ["TRADING_MODE paper", /TRADING_MODE\s*=\s*"paper"/],
  ["EXCHANGE_MODE paper", /EXCHANGE_MODE\s*=\s*"paper"/],
  ["ALLOW_MAINNET false", /ALLOW_MAINNET\s*=\s*"false"/],
  ["live route blocked", /\/intent\/live[\s\S]*403/],
  ["withdraw route blocked", /\/withdraw[\s\S]*403/],
];

const contents = files.map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
const failures = checks.filter(([, pattern]) => !pattern.test(contents));

if (failures.length > 0) {
  for (const [name] of failures) {
    console.error(`Paper-safety check failed: ${name}`);
  }
  process.exit(1);
}

console.log("Paper-safety checks passed.");
