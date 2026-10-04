export { ExchangeAccountCoordinator } from './live/observed-account-coordinator.ts'

// Private projection-only artifact for the same candidate Worker/namespace.
// No provider transport, financial public route or scheduled trigger is added.
export default {
  fetch(): Response {
    return Response.json({ artifact:'reviewed-projection-coordinator',
      publicCommands:false, providerMutationAllowed:false, executionAllowed:false },
      {status:404,headers:{'Cache-Control':'no-store'}})
  },
}
