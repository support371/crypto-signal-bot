import worker from './index_agent_context'
import type { AgentContextEnv } from './agent-context'
import {
  evaluateRequestAdmission,
  purgeExpiredRequestAdmissionCounters,
  requestAdmissionFailureResponse,
} from './request-admission-boundary'

export default {
  async fetch(
    request: Request,
    env: AgentContextEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const admission = await evaluateRequestAdmission(request, env)
    if (admission.status !== 'allowed') {
      return requestAdmissionFailureResponse(request, env, admission)
    }

    return worker.fetch(request, env, ctx)
  },

  scheduled(event: ScheduledEvent, env: AgentContextEnv, ctx: ExecutionContext): void {
    // Keep the admission table bounded without changing any existing cron job.
    ctx.waitUntil(purgeExpiredRequestAdmissionCounters(env))
    worker.scheduled(event, env, ctx)
  },
}
