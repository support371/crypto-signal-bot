import worker from './index_with_d1'
import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from './agent-context'
import {
  handleSwitchereFundingRequest,
  type SwitchereFundingEnv,
} from './switchere-funding'

export default {
  async fetch(
    request: Request,
    env: AgentContextEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const switchereResponse = await handleSwitchereFundingRequest(
      request,
      env as SwitchereFundingEnv,
    )
    if (switchereResponse) return switchereResponse

    const url = new URL(request.url)
    if (url.pathname === '/agent/context') {
      return handleAgentContextRequest(request, env)
    }
    return worker.fetch(request, env, ctx)
  },

  scheduled: worker.scheduled,
}
