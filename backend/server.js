import http from "http";
import { createListener } from "./src/listener.js";
import { createScorer } from "./src/scorer.js";
import { createGuardian } from "./src/guardian.js";
import { createExecutionRouter } from "./src/executionRouter.js";
import { createAuditStore } from "./src/auditStore.js";
import { ensureDataFiles, readJson, writeJson } from "./src/store.js";

const PORT = Number(process.env.PORT || 8787);
const MODE = process.env.TRADING_MODE || "paper";
const NETWORK = process.env.NETWORK || "paper";

await ensureDataFiles();

const auditStore = createAuditStore();
const listener = createListener({ auditStore });
const scorer = createScorer({ auditStore });
const guardian = createGuardian({ auditStore });
const executionRouter = createExecutionRouter({ auditStore });

const moduleStatus = {
  listener: "ready",
  scorer: "ready",
  guardian: "ready",
  executionRouter: "ready",
  auditStore: "ready",
  health: "ready"
};

async function runCycle() {
  const settings = await readJson("settings.json");
  const events = await listener.poll(settings);
  const opportunities = await scorer.score(events, settings);
  const decisions = await guardian.review(opportunities, settings);
  const result = await executionRouter.route(decisions, settings);

  const state = await readJson("state.json");
  state.lastCycleAt = new Date().toISOString();
  state.metrics.cycles += 1;
  state.metrics.eventsProcessed += events.length;
  state.metrics.opportunitiesScored += opportunities.length;
  state.metrics.ordersCreated += result.orders.length;
  state.metrics.approvals += decisions.filter((d) => d.approved).length;
  state.metrics.rejections += decisions.filter((d) => !d.approved).length;
  await writeJson("state.json", state);
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return send(res, 200, { ok: true });
    }

    const pathname = (req.url || "/").split("?")[0];

    if (req.method === "GET" && pathname === "/health") {
      const state = await readJson("state.json");
      const settings = await readJson("settings.json");
      return send(res, 200, {
        ok: true,
        mode: MODE,
        network: NETWORK,
        exchange: settings.primaryExchange,
        modules: moduleStatus,
        metrics: state.metrics,
        lastCycleAt: state.lastCycleAt
      });
    }

    if (req.method === "GET" && pathname === "/watchlist") return send(res, 200, await readJson("watchlist.json"));
    if (req.method === "GET" && pathname === "/positions") return send(res, 200, await readJson("positions.json"));
    if (req.method === "GET" && pathname === "/orders") return send(res, 200, await readJson("orders.json"));
    if (req.method === "GET" && pathname === "/audit") return send(res, 200, await readJson("audit.json"));
    if (req.method === "GET" && pathname === "/settings") return send(res, 200, await readJson("settings.json"));
    if (req.method === "GET" && pathname === "/state") return send(res, 200, await readJson("state.json"));

    if (req.method === "POST" && pathname === "/settings") {
      const patch = JSON.parse((await readBody(req)) || "{}");
      const current = await readJson("settings.json");
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await writeJson("settings.json", next);
      const state = await readJson("state.json");
      state.settings = next;
      await writeJson("state.json", state);
      await auditStore.append("settings", { keys: Object.keys(patch), updatedAt: next.updatedAt });
      return send(res, 200, next);
    }

    if (req.method === "POST" && pathname === "/cycle") {
      await runCycle();
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    await auditStore.append("errors", { message: error.message });
    return send(res, 500, { ok: false, error: error.message });
  }
});

setInterval(() => {
  runCycle().catch(() => {});
}, 12000);

await runCycle();
server.listen(PORT, () => {
  console.log("crypto-signal-bot backend running on port", PORT);
});
