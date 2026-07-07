const baseUrl = process.argv[2] ?? "https://crypto-signal-bot-api.gr8r9bfzry.workers.dev";

for (const path of ["/ready", "/trading-readiness"]) {
  const response = await fetch(new URL(path, baseUrl));
  const body = await response.json().catch(() => ({}));
  const ok = response.status === 200
    && body.paper_ready === true
    && body.live_ready === false
    && body.runtime === "cloudflare-workers";

  console.log(`${ok ? "PASS" : "FAIL"} GET ${path} -> ${response.status}`);
  if (!ok) {
    console.error(JSON.stringify(body));
    process.exitCode = 1;
  }
}
