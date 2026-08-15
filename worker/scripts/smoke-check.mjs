const baseUrl = process.argv[2] ?? "https://crypto-signal-bot-api.gr8r9bfzry.workers.dev";

const checks = [
  ["GET", "/healthz", 200, (body) => body.status === "ok"],
  ["GET", "/runtime/status", 200, (body) => body.trading_mode === "paper" && body.allow_mainnet === false],
  ["GET", "/surge/status", 200, (body) => body.scanner_active === true],
  ["GET", "/guardian/status", 200, (body) => Object.prototype.hasOwnProperty.call(body, "triggered")],
  ["GET", "/portfolio/summary", 200, (body) => body.mode === "paper"],
  ["GET", "/market/feed/status", 200, (body) => body.primary === "coinbase"],
  ["GET", "/exchange/circuit-breakers", 200, (body) => Array.isArray(body.adapters)],
  ["GET", "/v2/infrastructure/status", 200, (body) => body.version === "2.0" && body.runtime?.trading_mode === "paper" && body.runtime?.allow_mainnet === false],
  ["GET", "/agent/context", [200, 207], (body) => body.certification_mode === true && body.provider_mutation_enabled === false && body.real_funds_enabled === false],
  ["POST", "/intent/live", 403, (body) => body.code === 403],
  ["POST", "/live/order", 403, (body) => body.code === 403],
  ["POST", "/withdraw", 403, (body) => body.code === 403],
];

let failed = false;

for (const [method, path, expectedStatus, validateBody] of checks) {
  const response = await fetch(new URL(path, baseUrl), { method });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }

  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const ok = expectedStatuses.includes(response.status) && body !== undefined && validateBody(body);
  console.log(`${ok ? "PASS" : "FAIL"} ${method} ${path} -> ${response.status}`);
  if (!ok) {
    failed = true;
    console.error(text);
  }
}

if (failed) {
  process.exit(1);
}
