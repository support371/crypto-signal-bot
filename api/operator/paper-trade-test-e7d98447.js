const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const TIMEOUT_MS = 8000;
const EXPECTED_STARTING_CASH = 10000;
const STARTING_CASH_TOLERANCE = 10;
const TEST_NOTIONAL_USDT = 500;
const IDEMPOTENCY_KEY = 'one-shot-demo-e7d98447';

function json(response, status, payload) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.status(status).json(payload);
}

async function fetchJson(path, init = {}) {
  const upstream = await fetch(`${WORKER}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
    cache: 'no-store',
  });
  const text = await upstream.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: upstream.status, ok: upstream.ok, body };
}

function number(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }

  const operatorKey = process.env.BACKEND_API_KEY?.trim();
  if (!operatorKey) {
    return json(response, 503, {
      ok: false,
      error: 'server_operator_key_not_configured',
      note: 'No secret value is exposed by this endpoint.',
    });
  }

  try {
    const [health, runtime, guardian, portfolio] = await Promise.all([
      fetchJson('/health'),
      fetchJson('/runtime/status'),
      fetchJson('/guardian/status'),
      fetchJson('/portfolio/summary'),
    ]);

    if (!health.ok || !runtime.ok || !guardian.ok || !portfolio.ok) {
      return json(response, 503, {
        ok: false,
        error: 'paper_test_dependencies_unavailable',
        statuses: {
          health: health.status,
          runtime: runtime.status,
          guardian: guardian.status,
          portfolio: portfolio.status,
        },
      });
    }

    const runtimeMode = String(
      runtime.body?.trading_mode ?? runtime.body?.mode ?? health.body?.mode ?? '',
    ).toLowerCase();
    const portfolioMode = String(portfolio.body?.mode ?? '').toLowerCase();
    const allowMainnet = runtime.body?.allow_mainnet === true || health.body?.allow_mainnet === true;
    const liveTrading = runtime.body?.live_trading_enabled === true || health.body?.live_trading_enabled === true;
    const withdrawals = runtime.body?.withdrawals_enabled === true || health.body?.withdrawals_enabled === true;
    const guardianTriggered = guardian.body?.triggered === true || guardian.body?.kill_switch_active === true;

    if (
      runtimeMode !== 'paper'
      || portfolioMode !== 'paper'
      || allowMainnet
      || liveTrading
      || withdrawals
      || guardianTriggered
    ) {
      return json(response, 409, {
        ok: false,
        error: 'paper_safety_precondition_failed',
        safety: {
          runtime_mode: runtimeMode || 'unknown',
          portfolio_mode: portfolioMode || 'unknown',
          allow_mainnet: allowMainnet,
          live_trading_enabled: liveTrading,
          withdrawals_enabled: withdrawals,
          guardian_triggered: guardianTriggered,
        },
      });
    }

    const cashBefore = number(portfolio.body?.cash_usdt ?? portfolio.body?.balance_usdt);
    const positionCount = number(
      portfolio.body?.position_count ?? portfolio.body?.open_positions?.length ?? portfolio.body?.positions?.length ?? 0,
    );

    if (
      !Number.isFinite(cashBefore)
      || Math.abs(cashBefore - EXPECTED_STARTING_CASH) > STARTING_CASH_TOLERANCE
      || positionCount !== 0
    ) {
      return json(response, 409, {
        ok: false,
        error: 'one_shot_demo_precondition_not_met',
        note: 'No trade was submitted. This temporary probe only runs against a clean ~10,000 USDT paper wallet with no open position.',
        cash_before: Number.isFinite(cashBefore) ? cashBefore : null,
        position_count: Number.isFinite(positionCount) ? positionCount : null,
      });
    }

    const price = await fetchJson('/market/price/BTC');
    const referencePrice = number(price.body?.price);
    if (!price.ok || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return json(response, 503, {
        ok: false,
        error: 'btc_reference_price_unavailable',
        upstream_status: price.status,
      });
    }

    const quantity = Number((TEST_NOTIONAL_USDT / referencePrice).toFixed(8));
    const trade = await fetchJson('/orders', {
      method: 'POST',
      headers: {
        'X-API-Key': operatorKey,
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        side: 'BUY',
        quantity,
        price: referencePrice,
        notional_usdt: TEST_NOTIONAL_USDT,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    });

    if (!trade.ok || String(trade.body?.status ?? '').toUpperCase() !== 'FILLED') {
      return json(response, trade.status || 502, {
        ok: false,
        error: 'paper_trade_not_filled',
        upstream_status: trade.status,
        upstream: trade.body,
      });
    }

    const after = await fetchJson('/portfolio/summary');
    if (!after.ok) {
      return json(response, 502, {
        ok: false,
        error: 'paper_trade_filled_but_portfolio_verification_failed',
        trade: trade.body,
        portfolio_status: after.status,
      });
    }

    const cashAfter = number(after.body?.cash_usdt ?? after.body?.balance_usdt);
    const equityAfter = number(after.body?.equity_usdt);
    const afterPositionCount = number(
      after.body?.position_count ?? after.body?.open_positions?.length ?? after.body?.positions?.length ?? 0,
    );

    return json(response, 200, {
      ok: true,
      test: 'ONE_SHOT_10K_DEMO_PAPER_BUY',
      worker: WORKER,
      safety: {
        mode: 'paper',
        network: 'testnet',
        real_funds: false,
        withdrawals: false,
        provider_mutation: false,
      },
      before: {
        cash_usdt: cashBefore,
        position_count: positionCount,
      },
      trade: {
        id: trade.body?.id ?? trade.body?.order_id ?? null,
        status: trade.body?.status,
        symbol: trade.body?.symbol ?? 'BTCUSDT',
        side: trade.body?.side ?? 'BUY',
        quantity: number(trade.body?.quantity ?? quantity),
        fill_price: number(trade.body?.fill_price ?? trade.body?.price ?? referencePrice),
        notional_usdt: number(trade.body?.notional_usdt ?? TEST_NOTIONAL_USDT),
      },
      after: {
        cash_usdt: Number.isFinite(cashAfter) ? cashAfter : null,
        equity_usdt: Number.isFinite(equityAfter) ? equityAfter : null,
        position_count: Number.isFinite(afterPositionCount) ? afterPositionCount : null,
      },
      note: 'Executed once against the 10,000 USDT demo paper wallet. No real funds or live provider mutation were enabled.',
    });
  } catch (error) {
    return json(response, 503, {
      ok: false,
      error: 'paper_test_dependency_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
