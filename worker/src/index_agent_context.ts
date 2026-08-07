import worker from './index_with_d1'
import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from './agent-context'

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

    if (/^\/agent\/memory\/[^/]+$/.test(url.pathname) && request.method !== 'GET') {
      return Response.json(
        { error: 'Agent memory is read-only in this deployment' },
        {
          status: 405,
          headers: {
            Allow: 'GET',
            'Cache-Control': 'no-store',
          },
        },
      )
    }

    return worker.fetch(request, env, ctx)
  },

  scheduled: worker.scheduled,
}
