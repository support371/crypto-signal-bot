import worker from './index_agent_context'
import type { AgentContextEnv } from './agent-context'
import { discoverScheduledRecovery, type ScheduledRecoveryDiscoveryEnv } from './live/scheduled-recovery-discovery'
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

  async scheduled(event: ScheduledEvent, env: AgentContextEnv & ScheduledRecoveryDiscoveryEnv, ctx: ExecutionContext): Promise<void> {
    // Keep the admission table bounded without changing any existing cron job.
    ctx.waitUntil(purgeExpiredRequestAdmissionCounters(env))
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(discoverScheduledRecovery(env, event.scheduledTime))
    }
    await worker.scheduled(event, env, ctx)
  },
}
