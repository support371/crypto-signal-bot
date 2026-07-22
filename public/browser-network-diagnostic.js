const SERVER_DIAGNOSTIC_ROUTE = '/api/certification/backend-health';
const REQUEST_TIMEOUT_MS = 6_000;

const serverStatus = document.querySelector('#server-status');
const serverDetail = document.querySelector('#server-detail');
const browserStatus = document.querySelector('#browser-status');
const browserDetail = document.querySelector('#browser-detail');
const targetHost = document.querySelector('#target-host');
const interpretation = document.querySelector('#interpretation');
const runButton = document.querySelector('#run-diagnostic');

for (const element of [
  serverStatus,
  serverDetail,
  browserStatus,
  browserDetail,
  targetHost,
  interpretation,
  runButton,
]) {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Certification network diagnostic is missing a required element');
  }
}

function setStatus(element, label, tone) {
  element.textContent = label;
  element.dataset.tone = tone;
}

function normalizeWorkerHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (!host.endsWith('.workers.dev') || host.length > 253 || host.includes('..')) return null;

  const labels = host.split('.');
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (labels.some((label) => !validLabel.test(label))) return null;
  return host;
}

function validateServerSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Server diagnostic returned an invalid envelope');
  }
  if (value.schemaVersion !== 'certification-backend-health.v1' || value.readOnly !== true) {
    throw new Error('Server diagnostic returned an invalid contract');
  }
  if (!value.target || typeof value.target !== 'object' || Array.isArray(value.target)) {
    throw new Error('Server diagnostic did not provide target metadata');
  }
  if (!value.result || typeof value.result !== 'object' || Array.isArray(value.result)) {
    throw new Error('Server diagnostic did not provide a result');
  }
  if (value.responseBodyRead !== false || value.retriesAttempted !== 0) {
    throw new Error('Server diagnostic violated the read-only contract');
  }

  const host = normalizeWorkerHost(value.target.host);
  if (!host) throw new Error('Server diagnostic returned an unsupported Worker hostname');
  if (typeof value.result.healthy !== 'boolean' || typeof value.result.reachable !== 'boolean') {
    throw new Error('Server diagnostic returned invalid health flags');
  }
  if (typeof value.result.latencyMs !== 'number') {
    throw new Error('Server diagnostic returned an invalid latency');
  }

  return {
    host,
    healthy: value.result.healthy,
    reachable: value.result.reachable,
    statusCode: typeof value.result.statusCode === 'number' ? value.result.statusCode : null,
    latencyMs: value.result.latencyMs,
    state: typeof value.result.state === 'string' ? value.result.state : 'unknown',
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readServerDiagnostic() {
  const response = await fetchWithTimeout(SERVER_DIAGNOSTIC_ROUTE, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Server diagnostic returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Server diagnostic did not return JSON');
  }
  return validateServerSnapshot(await response.json());
}

async function readBrowserPath(host) {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(`https://${host}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });

    return {
      reachable: true,
      healthy: response.ok,
      statusCode: response.status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      state: response.ok ? 'healthy' : 'http-error',
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return {
      reachable: false,
      healthy: false,
      statusCode: null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      state: timedOut ? 'timeout' : 'network-or-cors-error',
    };
  }
}

function renderInterpretation(server, browser) {
  if (server.healthy && browser.healthy) {
    interpretation.textContent = 'Both paths are healthy. This browser can reach the same Worker that the platform server reached.';
    return;
  }
  if (server.healthy && !browser.healthy) {
    interpretation.textContent =
      'The Worker is healthy from the platform server, but this browser cannot complete the direct check. Investigate the device, carrier, DNS resolver, VPN, content filter, browser policy, CORS, or mobile-network path.';
    return;
  }
  if (!server.healthy) {
    interpretation.textContent =
      'The platform server did not receive a healthy Worker response. Investigate the configured Worker deployment or hostname before treating this as a browser-only problem.';
    return;
  }
  interpretation.textContent = 'The two paths produced inconsistent results. Retain the read-only fallback and review the diagnostic evidence.';
}

async function runDiagnostic() {
  runButton.setAttribute('disabled', '');
  setStatus(serverStatus, 'Checking', 'busy');
  serverDetail.textContent = 'Running one bounded same-origin diagnostic request.';
  setStatus(browserStatus, 'Waiting', 'busy');
  browserDetail.textContent = 'Waiting for a verified workers.dev hostname.';
  targetHost.textContent = 'Target: pending';
  interpretation.textContent = 'Checking the platform server path first.';

  try {
    const server = await readServerDiagnostic();
    targetHost.textContent = `Target: ${server.host}`;
    setStatus(serverStatus, server.healthy ? 'Healthy' : server.reachable ? 'Unhealthy response' : 'Unreachable', server.healthy ? 'ok' : 'warn');
    serverDetail.textContent = server.healthy
      ? `HTTP ${server.statusCode} in ${server.latencyMs} ms.`
      : `State: ${server.state}; HTTP ${server.statusCode ?? 'none'}; ${server.latencyMs} ms.`;

    setStatus(browserStatus, 'Checking', 'busy');
    browserDetail.textContent = 'Running one direct credential-free GET to the Worker health route.';
    const browser = await readBrowserPath(server.host);
    setStatus(browserStatus, browser.healthy ? 'Healthy' : browser.reachable ? 'Unhealthy response' : 'Unavailable', browser.healthy ? 'ok' : 'warn');
    browserDetail.textContent = browser.healthy
      ? `HTTP ${browser.statusCode} in ${browser.latencyMs} ms.`
      : `State: ${browser.state}; HTTP ${browser.statusCode ?? 'none'}; ${browser.latencyMs} ms.`;
    renderInterpretation(server, browser);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The diagnostic could not be completed.';
    setStatus(serverStatus, 'Diagnostic unavailable', 'warn');
    serverDetail.textContent = message;
    setStatus(browserStatus, 'Not run', 'warn');
    browserDetail.textContent = 'A verified Worker hostname was not available.';
    interpretation.textContent = 'The result is inconclusive. Keep using the static Certification Overview and do not infer backend health.';
  } finally {
    runButton.removeAttribute('disabled');
  }
}

runButton.addEventListener('click', () => {
  void runDiagnostic();
});

void runDiagnostic();
