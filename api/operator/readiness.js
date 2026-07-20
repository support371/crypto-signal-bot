const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Operator-Gateway': 'not-configured',
});

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
      error: 'Operator gateway is read only',
      code: 'OPERATOR_GATEWAY_READ_ONLY',
      readOnly: true,
    }, method === 'HEAD');
    return;
  }

  sendJson(response, 503, {
    error: 'Trusted operator identity gateway is not configured',
    code: 'OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED',
    readOnly: true,
    gatewayConfigured: false,
    activationEnabled: false,
    deploymentAllowed: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    realMoneyMovementAllowed: false,
    withdrawalsAllowed: false,
  }, method === 'HEAD');
}
