import worker, { type Env } from './index'

type D1ReadonlyRequest = {
  sql?: string
  params?: unknown[]
}

async function handleReadonlyD1Query(request: Request, env: Env): Promise<Response> {
  let body: D1ReadonlyRequest
  try {
    body = await request.json() as D1ReadonlyRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sql = String(body.sql ?? '').trim()
  if (!sql) {
    return Response.json({ error: 'sql is required' }, { status: 400 })
  }

  if (!sql.toUpperCase().startsWith('SELECT')) {
    return Response.json(
      { error: 'Only SELECT queries are permitted on this endpoint' },
      { status: 400 },
    )
  }

  const params = Array.isArray(body.params) ? body.params : []
  const result = await env.DB.prepare(sql).bind(...params).all()
  return Response.json({ result, readonly: true })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/d1/query/readonly') {
      return handleReadonlyD1Query(request, env)
    }
    return worker.fetch(request, env, ctx)
  },

  scheduled: worker.scheduled,
}
