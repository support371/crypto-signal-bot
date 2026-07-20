const SAFE_METHODS = new Set(['GET', 'HEAD'])

const LOCKED_PAYLOAD = Object.freeze({
  status: 'TRADE_CREDENTIALS_QUARANTINED',
  environment: 'bitget-trade-quarantine',
  deployedForExecution: false,
  credentialsValidated: false,
  credentialAccessAllowed: false,
  signingAllowed: false,
  providerTransportConfigured: false,
  providerMutationAllowed: false,
  executionAllowed: false,
  automaticRetryAllowed: false,
  withdrawalsAllowed: false,
  reason: 'Trade bindings are configuration-only and unreachable from this Worker handler',
})

const LOCKED_BODY = JSON.stringify(LOCKED_PAYLOAD)

function lockedResponse(request: Request): Response {
  const safeMethod = SAFE_METHODS.has(request.method.toUpperCase())
  return new Response(request.method.toUpperCase() === 'HEAD' ? null : LOCKED_BODY, {
    status: safeMethod ? 503 : 403,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Bitget-Trade-Quarantine': 'locked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export default {
  fetch(request: Request): Response {
    return lockedResponse(request)
  },
}
