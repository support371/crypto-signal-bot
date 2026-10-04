import { routePrivateBitgetCertification, type PrivateCertificationEnv } from './live/bitget-private-certification-service.ts'

// Service-binding ingress only. No public routes, cron or financial mutation.
export default {
  fetch(request: Request, env: PrivateCertificationEnv): Promise<Response> {
    return routePrivateBitgetCertification(request,env,{ fetcher: fetch, clock: Date.now })
  },
}
