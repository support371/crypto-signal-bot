import {
  authenticateOperatorRead,
  type OperatorReadAuthEnv,
  type OperatorReadResource,
} from './operator-read-auth.ts'
import {
  readLatestBitgetDemoDeploymentReadiness,
  type OperatorDeploymentReadinessEnv,
} from './operator-deployment-readiness-read-model.ts'
import {
  readActiveAlerts,
  readAuditHead,
  readLatestAttestedRecoveryReadiness,
  readLatestBitgetCertification,
  readLatestFillReconciliation,
  type OperatorReadModelEnv,
} from './operator-read-model.ts'
import {
  liveCandidateJson,
  type LiveCandidateResponseEnv,
} from './live-candidate-response.ts'

export const OPERATOR_READ_PREFIX = '/v1/operator/'

export type OperatorReadHttpEnv = OperatorReadAuthEnv
  & OperatorDeploymentReadinessEnv
  & OperatorReadModelEnv
  & LiveCandidateResponseEnv

export interface OperatorReadHttpDependencies {
  evaluateLiveCandidateReadiness(
    env: OperatorReadHttpEnv,
  ): Promise<Readonly<Record<string, unknown>>>
}

function requiredQuery(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)?.trim() ?? ''
  return value || null
}

async function authorizeOperator(
  request: Request,
  env: OperatorReadHttpEnv,
  resource: OperatorReadResource,
  exchangeAccountId: string | null,
): Promise<Response | { actorId: string; matchedRoles: readonly string[] }> {
  const globalResource = resource === 'ACTIVATION_GATE' || resource === 'DEPLOYMENT_READINESS'
  const result = await authenticateOperatorRead(env, request, {
    resource,
    exchangeName: globalResource ? null : 'BITGET',
    exchangeAccountId,
  })

  if (result.status === 'NOT_CONFIGURED') {
    return liveCandidateJson(request, env, {
      error: 'Operator authentication is not configured',
      code: result.code,
    }, 503)
  }
  if (result.status === 'UNAUTHENTICATED') {
    return liveCandidateJson(request, env, {
      error: 'Unauthorized',
      code: result.code,
    }, 401)
  }
  if (result.status === 'FORBIDDEN') {
    return liveCandidateJson(request, env, {
      error: 'Forbidden',
      code: result.code,
    }, 403)
  }

  return Object.freeze({
    actorId: result.principal.actorId,
    matchedRoles: result.principal.matchedRoles,
  })
}

async function handleOperatorRead(
  request: Request,
  env: OperatorReadHttpEnv,
  url: URL,
  dependencies: OperatorReadHttpDependencies,
): Promise<Response> {
  const pathname = url.pathname
  const exchangeAccountId = requiredQuery(url, 'account_id')
  const productId = requiredQuery(url, 'product_id')

  try {
    if (pathname === '/v1/operator/activation-gate') {
      const principal = await authorizeOperator(request, env, 'ACTIVATION_GATE', null)
      if (principal instanceof Response) return principal
      const report = await dependencies.evaluateLiveCandidateReadiness(env)
      return liveCandidateJson(request, env, {
        ...report,
        activationEnabled: false,
        activationBlocked: true,
        realMoneyMovementAllowed: false,
        operator: principal,
      }, 503)
    }

    if (pathname === '/v1/operator/deployment-readiness') {
      const principal = await authorizeOperator(request, env, 'DEPLOYMENT_READINESS', null)
      if (principal instanceof Response) return principal
      const evidence = await readLatestBitgetDemoDeploymentReadiness(env)
      return liveCandidateJson(request, env, {
        environment: 'live-candidate',
        readOnly: true,
        resource: 'DEPLOYMENT_READINESS',
        operator: principal,
        evidence,
        deploymentAllowed: false,
        demoRequestAllowed: false,
        credentialsRead: false,
        providerMutationAllowed: false,
        executionAllowed: false,
        withdrawalsAllowed: false,
      })
    }

    const resourceByPath: Readonly<Record<string, OperatorReadResource>> = {
      '/v1/operator/certification': 'CERTIFICATION',
      '/v1/operator/recovery-readiness': 'RECOVERY_READINESS',
      '/v1/operator/reconciliation': 'RECONCILIATION',
      '/v1/operator/alerts': 'ALERTS',
      '/v1/operator/audit-head': 'AUDIT_HEAD',
    }
    const resource = resourceByPath[pathname]
    if (!resource) {
      return liveCandidateJson(request, env, {
        error: 'Operator route not found',
        code: 'OPERATOR_ROUTE_NOT_FOUND',
      }, 404)
    }
    if (!exchangeAccountId) {
      return liveCandidateJson(request, env, {
        error: 'account_id is required',
        code: 'OPERATOR_ACCOUNT_ID_REQUIRED',
      }, 400)
    }

    const principal = await authorizeOperator(request, env, resource, exchangeAccountId)
    if (principal instanceof Response) return principal

    let evidence: unknown
    if (resource === 'CERTIFICATION') {
      evidence = await readLatestBitgetCertification(env, exchangeAccountId, productId)
    } else if (resource === 'RECOVERY_READINESS') {
      evidence = await readLatestAttestedRecoveryReadiness(env, exchangeAccountId, productId)
    } else if (resource === 'RECONCILIATION') {
      evidence = await readLatestFillReconciliation(env, exchangeAccountId, productId)
    } else if (resource === 'ALERTS') {
      const requestedLimit = Number(url.searchParams.get('limit') ?? '50')
      evidence = await readActiveAlerts(
        env,
        exchangeAccountId,
        Number.isFinite(requestedLimit) ? requestedLimit : 50,
      )
    } else {
      evidence = await readAuditHead(env, exchangeAccountId)
    }

    return liveCandidateJson(request, env, {
      environment: 'live-candidate',
      readOnly: true,
      resource,
      operator: principal,
      evidence,
      providerMutationAllowed: false,
      executionAllowed: false,
      withdrawalsAllowed: false,
    })
  } catch {
    return liveCandidateJson(request, env, {
      error: 'Operator evidence is unavailable',
      code: 'OPERATOR_EVIDENCE_UNAVAILABLE',
    }, 503)
  }
}

export async function routeOperatorReadRequest(
  request: Request,
  env: OperatorReadHttpEnv,
  dependencies: OperatorReadHttpDependencies,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(OPERATOR_READ_PREFIX)) return null

  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return liveCandidateJson(request, env, {
      error: 'Operator mutation routes are disabled',
      code: 'LIVE_CANDIDATE_READ_ONLY',
    }, 403)
  }

  return handleOperatorRead(request, env, url, dependencies)
}
