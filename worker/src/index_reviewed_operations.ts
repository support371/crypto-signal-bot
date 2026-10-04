import { routeReviewedOperation, type ReviewedOperationsEnv } from './live/reviewed-operations-gateway.ts'

// Isolated service-binding entrypoint. Public paper/candidate entrypoints keep
// their current mutation policy. Deploy only after the candidate resource gates.
export default {
  fetch(request: Request, env: ReviewedOperationsEnv): Promise<Response> {
    return routeReviewedOperation(request, env)
  },
}
