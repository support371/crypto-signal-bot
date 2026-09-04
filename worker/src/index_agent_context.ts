import worker from './index_with_d1'
import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from './agent-context'

function agentMemoryCorsHeaders(request: Request, env: AgentContextEnv): Headers {
  const configured = env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : ['*']
  const origin = request.headers.get('Origin')
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  })

  if (configured.includes('*')) {
    headers.set('Access-Control-Allow-Origin', origin ?? '*')
  } else if (origin && configured.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return headers
}

export default {
  async fetch(
    request: Request,
    env: AgentContextEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/agent/context') {
      return handleAgentContextRequest(request, env)
    }

    if (/^\/agent\/memory\/[^/]+$/.test(url.pathname)) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: agentMemoryCorsHeaders(request, env),
        })
      }

      if (request.method !== 'GET') {
        const headers = agentMemoryCorsHeaders(request, env)
        headers.set('Allow', 'GET, OPTIONS')
        headers.set('Content-Type', 'application/json; charset=utf-8')
        return new Response(
          JSON.stringify({ error: 'Agent memory is read-only in this deployment' }),
          { status: 405, headers },
        )
      }

      const response = await worker.fetch(request, env, ctx)
      const headers = new Headers(response.headers)
      for (const [name, value] of agentMemoryCorsHeaders(request, env)) {
        headers.set(name, value)
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return worker.fetch(request, env, ctx)
  },

  scheduled: worker.scheduled,
}
