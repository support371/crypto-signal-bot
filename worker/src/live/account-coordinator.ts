export interface AccountCoordinatorEnv {
  BUILD_GIT_SHA?: string
  LIVE_EXECUTION_ENABLED?: string
  WITHDRAWALS_ENABLED?: string
}

interface CoordinatorMetadata {
  schemaVersion: 1
  createdAt: string
  halted: true
  haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED'
}

const METADATA_KEY = 'coordinator:metadata'

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Live-Candidate': 'read-only',
    },
  })
}

/**
 * Serializes future commands for one exchange account.
 *
 * This first candidate implementation intentionally accepts no mutations. The
 * Durable Object binding establishes the isolation and single-writer boundary
 * without creating an exchange execution path.
 */
export class ExchangeAccountCoordinator {
  private readonly state: DurableObjectState
  private readonly env: AccountCoordinatorEnv
  private metadata: CoordinatorMetadata | null = null

  constructor(state: DurableObjectState, env: AccountCoordinatorEnv) {
    this.state = state
    this.env = env
    this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get<CoordinatorMetadata>(METADATA_KEY)
      if (existing) {
        this.metadata = existing
        return
      }

      const created: CoordinatorMetadata = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        halted: true,
        haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
      }
      await this.state.storage.put(METADATA_KEY, created)
      this.metadata = created
    })
  }

  private snapshot(): Record<string, unknown> {
    return {
      coordinatorId: this.state.id.toString(),
      schemaVersion: this.metadata?.schemaVersion ?? 1,
      createdAt: this.metadata?.createdAt ?? null,
      halted: true,
      haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
      orderSubmissionEnabled: false,
      cancellationEnabled: false,
      withdrawalsEnabled: false,
      configuredLiveFlag: String(this.env.LIVE_EXECUTION_ENABLED ?? '').toLowerCase() === 'true',
      configuredWithdrawalsFlag: String(this.env.WITHDRAWALS_ENABLED ?? '').toLowerCase() === 'true',
      buildGitSha: String(this.env.BUILD_GIT_SHA ?? ''),
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/health' || url.pathname === '/state')) {
      const response = json(this.snapshot())
      return method === 'HEAD'
        ? new Response(null, { status: response.status, headers: response.headers })
        : response
    }

    return json({
      error: 'Exchange account coordinator is execution-locked',
      code: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
    }, 423)
  }
}
