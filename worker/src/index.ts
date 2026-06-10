import { Hono } from "hono";
import { cors } from "hono/cors";

interface PriceRow {
  price: number;
}

interface BalanceRow {
  quantity: number;
}

interface EarningsTotalRow {
  total_pnl: number | null;
}

interface GuardianStateRow {
  triggered: number;
  reason: string | null;
  error_count: number;
  drawdown_pct: number;
}

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  GUARDIAN: DurableObjectNamespace;
  CIRCUIT_BREAKER: DurableObjectNamespace;
  SURGE_TRACKER: DurableObjectNamespace;
  TRADING_MODE: string;
  EXCHANGE_MODE: string;
  NETWORK: string;
  ALLOW_MAINNET: string;
  MARKET_DATA_PUBLIC_EXCHANGE: string;
  PAPER_STARTING_BALANCE_USDT: string;
  GUARDIAN_MAX_DRAWDOWN_PCT: string;
  GUARDIAN_MAX_API_ERRORS: string;
  GUARDIAN_MAX_FAILED_ORDERS: string;
  RATE_LIMIT_RPM: string;
  CORS_ALLOWED_ORIGINS: string;
  BACKEND_API_KEY?: string;
}

type DurableObjectStateLike = DurableObjectState;

class JsonDurableObject {
  protected state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stored = (await this.state.storage.get<Record<string, unknown>>("state")) ?? {};

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      await this.state.storage.put("state", { ...stored, ...body, updatedAt: new Date().toISOString() });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: true, path: url.pathname, state: stored });
  }
}

export class GuardianObject extends JsonDurableObject {}
export class CircuitBreaker extends JsonDurableObject {}
export class SurgeTracker extends JsonDurableObject {}

const app = new Hono<{ Bindings: Env }>();

function envFlag(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function paperSafetyStatus(env: Env) {
  return {
    trading_mode: env.TRADING_MODE,
    exchange_mode: env.EXCHANGE_MODE,
    allow_mainnet: envFlag(env.ALLOW_MAINNET),
    live_trading_enabled: false,
    withdrawals_enabled: false,
  };
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function allowedOrigins(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
}

async function audit(env: Env, event: string, detail?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_trail (event, detail) VALUES (?, ?)")
    .bind(event, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

async function coinbaseSpot(symbol: string): Promise<number> {
  const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Coinbase returned ${response.status}`);
  }

  const data = (await response.json()) as { data?: { amount?: string } };
  const price = Number.parseFloat(data.data?.amount ?? "");
  if (!Number.isFinite(price)) {
    throw new Error("Invalid price from Coinbase");
  }

  return price;
}

async function refreshMarketSnapshot(env: Env, symbol: string): Promise<number> {
  const price = await coinbaseSpot(symbol);
  await env.DB.prepare("INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)")
    .bind(symbol, price, "coinbase")
    .run();
  return price;
}

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const configured = allowedOrigins(c.env);
      if (!origin) return configured[0] ?? "*";
      return configured.includes(origin) ? origin : configured[0] ?? origin;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  }),
);

app.get("/healthz", (c) => c.json({ status: "ok", mode: "paper", ts: Date.now() }));
app.get("/health", (c) => c.json({ status: "ok", mode: "paper", ts: Date.now() }));

app.get("/runtime/status", (c) => c.json({
  ...paperSafetyStatus(c.env),
  market_data_source: c.env.MARKET_DATA_PUBLIC_EXCHANGE,
  starting_balance: parseNumber(c.env.PAPER_STARTING_BALANCE_USDT, 10000),
  guardian_max_drawdown: parseNumber(c.env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
  network: c.env.NETWORK,
  runtime: "cloudflare-workers",
  region: "global-edge",
  ts: Date.now(),
}));

app.post("/intent/live", (c) => c.json({ error: "Live trading is disabled", code: 403 }, 403));
app.post("/withdraw", (c) => c.json({ error: "Withdrawals are disabled", code: 403 }, 403));

app.get("/market/price/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();

  try {
    const price = await refreshMarketSnapshot(c.env, symbol);
    return c.json({ symbol, price, source: "coinbase", stale: false, ts: Date.now() });
  } catch (error) {
    const cached = await c.env.DB.prepare(
      "SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(symbol).first<PriceRow>();

    if (cached) {
      return c.json({ symbol, price: cached.price, source: "cache", stale: true, ts: Date.now() });
    }

    return c.json({ error: "Market data unavailable", detail: error instanceof Error ? error.message : "unknown" }, 503);
  }
});

app.get("/market/feed/status", (c) => {
  const adapters = ["coinbase", "binance", "bitget", "btcc", "coingecko"];
  return c.json({
    primary: "coinbase",
    adapters: adapters.map((name) => ({
      name,
      status: name === "coinbase" ? "healthy" : "standby",
      circuit_breaker: "closed",
      execution_enabled: false,
    })),
    ts: Date.now(),
  });
});

app.get("/signals", async (c) => {
  const symbol = (c.req.query("symbol") || "BTC").toUpperCase();
  const signal = await c.env.DB.prepare(
    "SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1",
  ).bind(symbol).first();

  return c.json(signal || {
    symbol,
    side: "FLAT",
    confidence: 0,
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    message: "No signal generated yet",
  });
});

app.get("/signals/history", async (c) => {
  const symbol = (c.req.query("symbol") || "BTC").toUpperCase();
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "20", 10), 100);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT ?",
  ).bind(symbol, limit).all();
  return c.json(rows.results || []);
});

app.get("/portfolio/summary", async (c) => {
  const positions = await c.env.DB.prepare(
    "SELECT * FROM portfolio WHERE status = 'open' AND symbol != 'USDT'",
  ).all();
  const balance = await c.env.DB.prepare(
    "SELECT quantity FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1",
  ).first<BalanceRow>();
  const earnings = await c.env.DB.prepare("SELECT SUM(pnl) as total_pnl FROM earnings").first<EarningsTotalRow>();

  return c.json({
    balance_usdt: balance?.quantity || parseNumber(c.env.PAPER_STARTING_BALANCE_USDT, 10000),
    open_positions: positions.results || [],
    position_count: (positions.results || []).length,
    total_pnl: earnings?.total_pnl || 0,
    mode: "paper",
    ts: Date.now(),
  });
});

app.get("/portfolio/trades", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50").all();
  return c.json(rows.results || []);
});

app.post("/intent/paper", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Partial<{
    symbol: string;
    side: string;
    quantity: number;
    price: number;
  }>;
  const { symbol, side, quantity, price } = body;

  if (!symbol || !side || !quantity || !price) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const guardian = await c.env.DB.prepare("SELECT triggered FROM guardian_state WHERE id = 1")
    .first<{ triggered: number }>();
  if (guardian?.triggered) {
    return c.json({ error: "Guardian kill switch active — trading paused" }, 403);
  }

  await c.env.DB.prepare(
    "INSERT INTO orders (symbol, side, quantity, price, status, mode) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(symbol.toUpperCase(), side.toUpperCase(), quantity, price, "filled", "paper").run();
  await audit(c.env, "paper_trade", { symbol, side, quantity, price });

  return c.json({ status: "filled", symbol: symbol.toUpperCase(), side, quantity, price, mode: "paper", ts: Date.now() });
});

app.get("/guardian/status", async (c) => {
  const state = await c.env.DB.prepare("SELECT * FROM guardian_state WHERE id = 1").first<GuardianStateRow>();
  return c.json(state || { triggered: false, reason: null, error_count: 0, drawdown_pct: 0 });
});

app.post("/guardian/kill", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { reason?: string };
  const reason = body.reason || "Manual kill switch activated";
  await c.env.DB.prepare(
    "UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
  ).bind(reason).run();
  await audit(c.env, "guardian_kill", reason);
  return c.json({ status: "triggered", reason, ts: Date.now() });
});

app.post("/guardian/reset", async (c) => {
  await c.env.DB.prepare(
    "UPDATE guardian_state SET triggered = 0, reason = NULL, error_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
  ).run();
  await audit(c.env, "guardian_reset", "Manual reset");
  return c.json({ status: "reset", triggered: false, ts: Date.now() });
});

app.get("/surge/status", async (c) => {
  const events = await c.env.DB.prepare("SELECT * FROM surge_events ORDER BY triggered_at DESC LIMIT 10").all();
  const snapshots = await c.env.DB.prepare(
    "SELECT symbol, price, created_at FROM market_snapshots WHERE symbol IN ('BTC', 'ETH', 'SOL', 'BNB') ORDER BY created_at DESC LIMIT 4",
  ).all();

  return c.json({
    scanner_active: true,
    assets: ["BTC", "ETH", "SOL", "BNB"],
    window_minutes: 20,
    stop_loss_pct: 5,
    recent_events: events.results || [],
    latest_snapshots: snapshots.results || [],
    ts: Date.now(),
  });
});

app.get("/exchange/circuit-breakers", (c) => c.json({
  adapters: ["coinbase", "binance", "bitget", "btcc", "coingecko"].map((name) => ({
    name,
    status: "closed",
    failures: 0,
    execution_enabled: false,
  })),
  ts: Date.now(),
}));

app.get("/audit", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM audit_trail ORDER BY timestamp DESC LIMIT 50").all();
  return c.json(rows.results || []);
});

app.get("/backtest", (c) => {
  const symbol = (c.req.query("symbol") || "BTC").toUpperCase();
  return c.json({
    symbol,
    status: "ready",
    message: "Backtest engine available — submit POST /backtest with strategy config",
    supported_strategies: ["ema_cross", "rsi_mean_reversion", "macd_momentum"],
    ts: Date.now(),
  });
});

app.post("/backtest", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = `backtests/${new Date().toISOString()}.json`;
  await c.env.STORAGE.put(key, JSON.stringify({ body, ts: Date.now() }), {
    httpMetadata: { contentType: "application/json" },
  });
  await audit(c.env, "backtest_submitted", { key });
  return c.json({ status: "stored", key, mode: "paper", ts: Date.now() });
});

async function refreshTrackedMarkets(env: Env): Promise<void> {
  for (const symbol of ["BTC", "ETH", "SOL", "BNB"]) {
    try {
      await refreshMarketSnapshot(env, symbol);
    } catch {
      // Keep scheduled jobs resilient; route handlers can fall back to cache.
    }
  }
}

async function scanSurges(env: Env): Promise<void> {
  for (const symbol of ["BTC", "ETH", "SOL", "BNB"]) {
    try {
      const now = await env.DB.prepare(
        "SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1",
      ).bind(symbol).first<PriceRow>();
      const ago = await env.DB.prepare(
        "SELECT price FROM market_snapshots WHERE symbol = ? AND created_at <= datetime('now', '-20 minutes') ORDER BY created_at DESC LIMIT 1",
      ).bind(symbol).first<PriceRow>();

      if (now && ago && ago.price > 0) {
        const changePct = ((now.price - ago.price) / ago.price) * 100;
        if (changePct >= 5) {
          const allocationPct = changePct >= 15 ? 10 : 5;
          await env.DB.prepare("INSERT INTO surge_events (symbol, change_pct, allocation_pct) VALUES (?, ?, ?)")
            .bind(symbol, changePct, allocationPct)
            .run();
          await audit(env, "surge_detected", { symbol, changePct, allocationPct });
        }
      }
    } catch {
      // Skip one symbol without failing the whole cron run.
    }
  }
}

async function checkGuardianDrawdown(env: Env): Promise<void> {
  const earnings = await env.DB.prepare("SELECT SUM(pnl) as total_pnl FROM earnings").first<EarningsTotalRow>();
  const totalPnl = earnings?.total_pnl || 0;
  const startBalance = parseNumber(env.PAPER_STARTING_BALANCE_USDT, 10000);
  const maxDrawdown = parseNumber(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15);
  const drawdown = ((startBalance - (startBalance + totalPnl)) / startBalance) * 100;

  if (drawdown >= maxDrawdown) {
    await env.DB.prepare(
      "UPDATE guardian_state SET triggered = 1, reason = ?, drawdown_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    ).bind(`Max drawdown reached: ${drawdown.toFixed(2)}%`, drawdown).run();
  }
}

async function snapshotDailyEarnings(env: Env): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await env.DB.prepare("INSERT OR IGNORE INTO earnings (date, pnl, cumulative_pnl) VALUES (?, 0, 0)")
    .bind(today)
    .run();
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const jobs: Promise<void>[] = [];

    if (event.cron === "*/5 * * * *") {
      jobs.push(refreshTrackedMarkets(env));
    }
    if (event.cron === "*/20 * * * *") {
      jobs.push(scanSurges(env));
    }
    if (event.cron === "0 * * * *") {
      jobs.push(checkGuardianDrawdown(env));
    }
    if (event.cron === "0 0 * * *") {
      jobs.push(snapshotDailyEarnings(env));
    }

    ctx.waitUntil(Promise.all(jobs).then(() => undefined));
  },
};
