const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const PRIMARY_EXECUTION_EXCHANGE = 'btcc';
const SECONDARY_EXECUTION_EXCHANGE = 'bitget';
const REQUEST_TIMEOUT_MS = 8000;
const MANAGEMENT_PATH = '/v1/management/me';

const endpointChecks = [
  '/healthz',
  '/runtime/status',
  '/v2/infrastructure/status',
  '/agent/context',
  '/exchange/circuit-breakers',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function probe(path) {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL(path, `${WORKER}/`), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const contentType = response.headers.get('content-type') ?? '';
    return {
      path,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      content_type: contentType,
      json: contentType.includes('application/json') && isRecord(body),
      body,
      text: body ? undefined : text.slice(0, 220),
    };
  } catch (error) {
    return {
      path,
      status: null,
      latency_ms: Date.now() - startedAt,
      content_type: null,
      json: false,
      body: null,
      error: safeError(error),
    };
  }
}

function findResult(results, path) {
  return results.find((result) => result.path === path);
}

function addInvariant(invariants, id, passed, detail) {
  invariants.push({ id, passed: Boolean(passed), detail });
}

function circuitBreakerClosed(circuitPayload, source) {
  const adapters = Array.isArray(circuitPayload?.adapters) ? circuitPayload.adapters : [];
  const adapter = adapters.find((item) => item?.source === source);
  return Boolean(adapter) && adapter.open === false;
}

function buildAttestation(results, management) {
  const health = findResult(results, '/healthz');
  const runtime = findResult(results, '/runtime/status');
  const infrastructure = findResult(results, '/v2/infrastructure/status');
  const agent = findResult(results, '/agent/context');
  const breakers = findResult(results, '/exchange/circuit-breakers');
  const invariants = [];

  for (const result of results) {
    addInvariant(
      invariants,
      `endpoint:${result.path}`,
      result.status === 200 && result.json,
      result.status === 200 && result.json
        ? `HTTP 200 JSON in ${result.latency_ms}ms`
        : `status=${result.status ?? 'unreachable'} content-type=${result.content_type ?? 'none'}`,
    );
  }

  addInvariant(invariants, 'worker:health', health?.body?.status === 'ok', `status=${health?.body?.status ?? 'missing'}`);
  addInvariant(
    invariants,
    'worker:provider',
    health?.body?.provider === 'cloudflare-worker' || health?.body?.runtime === 'cloudflare-workers',
    `provider=${health?.body?.provider ?? health?.body?.runtime ?? 'missing'}`,
  );

  const safetyPayloads = [health?.body, runtime?.body, infrastructure?.body?.runtime, agent?.body].filter(isRecord);
  addInvariant(
    invariants,
    'safety:paper',
    safetyPayloads.length >= 3 && safetyPayloads.every((body) => (body.trading_mode ?? body.mode) === 'paper'),
    'trading_mode must remain paper across public runtime contracts',
  );
  addInvariant(
    invariants,
    'safety:testnet',
    [health?.body?.network, runtime?.body?.network, infrastructure?.body?.runtime?.network, agent?.body?.network]
      .filter((value) => value !== undefined)
      .every((value) => value === 'testnet'),
    'network must remain testnet across public runtime contracts',
  );
  addInvariant(
    invariants,
    'safety:mainnet-disabled',
    [health?.body?.allow_mainnet, runtime?.body?.allow_mainnet, infrastructure?.body?.runtime?.allow_mainnet, agent?.body?.allow_mainnet]
      .filter((value) => value !== undefined)
      .every((value) => value === false),
    'allow_mainnet must remain false',
  );
  addInvariant(
    invariants,
    'safety:live-disabled',
    [health?.body?.live_trading_enabled, runtime?.body?.live_trading_enabled, infrastructure?.body?.runtime?.live_trading_enabled, agent?.body?.live_trading_enabled]
      .filter((value) => value !== undefined)
      .every((value) => value === false),
    'live_trading_enabled must remain false',
  );
  addInvariant(
    invariants,
    'safety:withdrawals-disabled',
    [health?.body?.withdrawals_enabled, runtime?.body?.withdrawals_enabled, infrastructure?.body?.runtime?.withdrawals_enabled, agent?.body?.withdrawals_enabled]
      .filter((value) => value !== undefined)
      .every((value) => value === false),
    'withdrawals_enabled must remain false',
  );
  addInvariant(
    invariants,
    'safety:provider-mutation-disabled',
    agent?.body?.provider_mutation_enabled === false && agent?.body?.real_funds_enabled === false,
    `provider_mutation_enabled=${agent?.body?.provider_mutation_enabled ?? 'missing'} real_funds_enabled=${agent?.body?.real_funds_enabled ?? 'missing'}`,
  );

  const exchangePayloads = [health?.body, runtime?.body, agent?.body].filter(isRecord);
  addInvariant(
    invariants,
    'execution:primary-btcc',
    exchangePayloads.length >= 3 && exchangePayloads.every((body) => body.execution_exchange_primary === PRIMARY_EXECUTION_EXCHANGE),
    'primary execution exchange must be BTCC',
  );
  addInvariant(
    invariants,
    'execution:secondary-bitget',
    exchangePayloads.length >= 3 && exchangePayloads.every((body) => body.execution_exchange_secondary === SECONDARY_EXECUTION_EXCHANGE),
    'secondary execution exchange must be Bitget',
  );

  addInvariant(
    invariants,
    'storage:d1-reachable',
    infrastructure?.body?.projections?.d1_status === 'healthy' && agent?.body?.runtime?.status === 'ok',
    `d1_status=${infrastructure?.body?.projections?.d1_status ?? 'missing'} runtime=${agent?.body?.runtime?.status ?? 'missing'}`,
  );
  addInvariant(
    invariants,
    'storage:agent-memory',
    agent?.body?.memory_available === true,
    `memory_available=${agent?.body?.memory_available ?? 'missing'}`,
  );
  addInvariant(
    invariants,
    'guardian:nominal',
    agent?.body?.guardian?.status === 'ok' && agent?.body?.halted === false,
    `guardian=${agent?.body?.guardian?.status ?? 'missing'} halted=${agent?.body?.halted ?? 'missing'}`,
  );
  addInvariant(
    invariants,
    'circuit-breaker:btcc-closed',
    circuitBreakerClosed(breakers?.body, PRIMARY_EXECUTION_EXCHANGE),
    'BTCC circuit breaker must be present and closed',
  );
  addInvariant(
    invariants,
    'circuit-breaker:bitget-closed',
    circuitBreakerClosed(breakers?.body, SECONDARY_EXECUTION_EXCHANGE),
    'Bitget circuit breaker must be present and closed',
  );

  const managementCode = isRecord(management?.body) ? management.body.code : null;
  const managementRoutePresent = management?.status !== null && management?.status !== 404;
  const identityProviderConfigured = managementRoutePresent
    && !(management?.status === 503 && managementCode === 'AUTH_PROVIDER_UNCONFIGURED');
  const managementAuthEnforced = management?.status === 401 && managementCode === 'UNAUTHENTICATED';

  addInvariant(
    invariants,
    'management:route-present',
    managementRoutePresent,
    `anonymous management probe status=${management?.status ?? 'unreachable'}`,
  );
  addInvariant(
    invariants,
    'management:identity-provider-configured',
    identityProviderConfigured,
    `code=${managementCode ?? 'none'}`,
  );
  addInvariant(
    invariants,
    'management:authentication-enforced',
    managementAuthEnforced,
    `expected 401 UNAUTHENTICATED; got status=${management?.status ?? 'unreachable'} code=${managementCode ?? 'none'}`,
  );

  const failures = invariants.filter((item) => !item.passed);
  return {
    ok: failures.length === 0,
    attestation_version: '2026-09-06.1',
    generated_at: new Date().toISOString(),
    worker: WORKER,
    execution: {
      primary: PRIMARY_EXECUTION_EXCHANGE,
      secondary: SECONDARY_EXECUTION_EXCHANGE,
    },
    safety: {
      trading_mode: runtime?.body?.trading_mode ?? health?.body?.trading_mode ?? null,
      network: runtime?.body?.network ?? health?.body?.network ?? null,
      allow_mainnet: runtime?.body?.allow_mainnet ?? null,
      live_trading_enabled: runtime?.body?.live_trading_enabled ?? null,
      withdrawals_enabled: runtime?.body?.withdrawals_enabled ?? null,
      provider_mutation_enabled: agent?.body?.provider_mutation_enabled ?? null,
      real_funds_enabled: agent?.body?.real_funds_enabled ?? null,
    },
    storage: {
      d1_status: infrastructure?.body?.projections?.d1_status ?? null,
      agent_memory_available: agent?.body?.memory_available ?? null,
    },
    management: {
      route_present: managementRoutePresent,
      identity_provider_configured: identityProviderConfigured,
      authentication_enforced: managementAuthEnforced,
      anonymous_status: management?.status ?? null,
      anonymous_code: managementCode ?? null,
      latency_ms: management?.latency_ms ?? null,
    },
    invariants,
    failures,
    probes: results.map(({ body, text, ...result }) => ({
      ...result,
      summary: isRecord(body)
        ? {
            status: body.status ?? body.ok ?? null,
            mode: body.trading_mode ?? body.mode ?? null,
          }
        : text ?? null,
    })),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const [results, management] = await Promise.all([
    Promise.all(endpointChecks.map((path) => probe(path))),
    probe(MANAGEMENT_PATH),
  ]);
  const attestation = buildAttestation(results, management);
  return res.status(attestation.ok ? 200 : 503).json(attestation);
}
