const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Certification-Mirror': 'read-only',
});

const CAPABILITY_LOCKS = Object.freeze({
  deploymentAllowed: false,
  providerMutationAllowed: false,
  executionAllowed: false,
  mainnetAllowed: false,
  realFundsAllowed: false,
  withdrawalsAllowed: false,
  automaticRetryAllowed: false,
});

function safeDeploymentEnvironment(value) {
  return value === 'production' || value === 'preview' || value === 'development' ? value : 'unknown';
}

function safeCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{7,40}$/i.test(value) ? value.slice(0, 12) : 'unknown';
}

function sendJson(response, status, payload, suppressBody = false) {
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    response.setHeader(name, value);
  }
  response.statusCode = status;
  response.end(suppressBody ? undefined : JSON.stringify(payload));
}

export default function handler(request, response) {
  const method = String(request.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    response.setHeader('Allow', 'GET, HEAD, OPTIONS');
    response.setHeader('Cache-Control', 'no-store');
    response.statusCode = 204;
    response.end();
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD, OPTIONS');
    sendJson(response, 405, {
      error: 'Certification status endpoint is read only',
      code: 'CERTIFICATION_STATUS_READ_ONLY',
      readOnly: true,
    }, method === 'HEAD');
    return;
  }

  sendJson(response, 200, {
    schemaVersion: 'certification-status.v1',
    mode: 'CERTIFICATION',
    readOnly: true,
    generatedAt: new Date().toISOString(),
    release: {
      packageVersion: '0.0.0',
      channel: 'preview-candidate',
      commit: safeCommit(process.env.VERCEL_GIT_COMMIT_SHA),
      environment: safeDeploymentEnvironment(process.env.VERCEL_ENV),
    },
    services: {
      publicApplication: 'available',
      certificationMirror: 'available',
      connectedDashboard: 'external-health-required',
      userAuthentication: 'configuration-required',
      operatorGateway: 'disconnected',
    },
    capabilities: CAPABILITY_LOCKS,
  }, method === 'HEAD');
}
