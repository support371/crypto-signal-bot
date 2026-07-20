import {
  CanonicalizationError,
  canonicalJson,
  sha256Hex,
} from './canonical-json.ts'

export type MutationStatus =
  | 'CLAIMED'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'

export interface IdempotencyEnv {
  DB: D1Database
}

export interface MutationClaimInput {
  operationScope: string
  idempotencyKey: string
  exchangeAccountId: string
  actorId: string
  payload: unknown
  expiresAt?: string | null
}

export type MutationClaimResult =
  | {
      state: 'CLAIMED'
      operationId: string
      status: 'CLAIMED'
      response: null
    }
  | {
      state: 'IN_PROGRESS' | 'RECOVERY_REQUIRED'
      operationId: string
      status: MutationStatus
      response: null
    }
  | {
      state: 'REPLAY'
      operationId: string
      status: 'SUCCEEDED' | 'FAILED'
      response: unknown
    }
  | {
      state: 'CONFLICT'
      operationId: string
      status: MutationStatus
      response: null
    }

interface IdempotencyRow {
  operation_scope: string
  idempotency_key: string
  request_hash: string
  operation_id: string
  exchange_account_id: string
  actor_id: string
  status: MutationStatus
  response_json: string | null
  error_code: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/
const OPERATION_SCOPE_PATTERN = /^[a-z][a-z0-9._:-]{2,63}$/
const TERMINAL_STATUSES = new Set<MutationStatus>(['SUCCEEDED', 'FAILED'])

export class InvalidIdempotencyInput extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidIdempotencyInput'
  }
}

function validateInput(input: MutationClaimInput): void {
  if (!OPERATION_SCOPE_PATTERN.test(input.operationScope)) {
    throw new InvalidIdempotencyInput(
      'operationScope must be 3-64 lowercase characters using letters, numbers, dot, underscore, colon, or hyphen',
    )
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new InvalidIdempotencyInput(
      'Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
    )
  }
  if (!input.exchangeAccountId.trim()) {
    throw new InvalidIdempotencyInput('exchangeAccountId is required')
  }
  if (!input.actorId.trim()) {
    throw new InvalidIdempotencyInput('actorId is required')
  }
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new InvalidIdempotencyInput('expiresAt must be a valid ISO-8601 timestamp')
  }
}

function serializeCanonical(value: unknown): string {
  try {
    return canonicalJson(value)
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new InvalidIdempotencyInput(error.message)
    }
    throw error
  }
}

export async function mutationRequestHash(input: MutationClaimInput): Promise<string> {
  validateInput(input)
  return sha256Hex(serializeCanonical({
    operationScope: input.operationScope,
    exchangeAccountId: input.exchangeAccountId,
    actorId: input.actorId,
    payload: input.payload,
  }))
}

function decodeResponse(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

async function readRecord(
  env: IdempotencyEnv,
  operationScope: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> {
  return env.DB.prepare(
    `SELECT operation_scope, idempotency_key, request_hash, operation_id,
            exchange_account_id, actor_id, status, response_json, error_code,
            created_at, updated_at, expires_at
       FROM idempotency_records
      WHERE operation_scope = ? AND idempotency_key = ?
      LIMIT 1`,
  ).bind(operationScope, idempotencyKey).first<IdempotencyRow>()
}

export async function claimMutation(
  env: IdempotencyEnv,
  input: MutationClaimInput,
): Promise<MutationClaimResult> {
  validateInput(input)
  const requestHash = await mutationRequestHash(input)
  const operationId = crypto.randomUUID()

  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO idempotency_records (
       operation_scope, idempotency_key, request_hash, operation_id,
       exchange_account_id, actor_id, status, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'CLAIMED', ?)`,
  ).bind(
    input.operationScope,
    input.idempotencyKey,
    requestHash,
    operationId,
    input.exchangeAccountId,
    input.actorId,
    input.expiresAt ?? null,
  ).run()

  if ((insert.meta?.changes ?? 0) === 1) {
    return { state: 'CLAIMED', operationId, status: 'CLAIMED', response: null }
  }

  const existing = await readRecord(env, input.operationScope, input.idempotencyKey)
  if (!existing) {
    throw new Error('Idempotency record was not readable after a uniqueness collision')
  }

  if (existing.request_hash !== requestHash) {
    return {
      state: 'CONFLICT',
      operationId: existing.operation_id,
      status: existing.status,
      response: null,
    }
  }

  if (TERMINAL_STATUSES.has(existing.status)) {
    return {
      state: 'REPLAY',
      operationId: existing.operation_id,
      status: existing.status as 'SUCCEEDED' | 'FAILED',
      response: decodeResponse(existing.response_json),
    }
  }

  if (existing.status === 'RECOVERY_REQUIRED') {
    return {
      state: 'RECOVERY_REQUIRED',
      operationId: existing.operation_id,
      status: existing.status,
      response: null,
    }
  }

  return {
    state: 'IN_PROGRESS',
    operationId: existing.operation_id,
    status: existing.status,
    response: null,
  }
}

async function updateStatus(
  env: IdempotencyEnv,
  input: {
    operationScope: string
    idempotencyKey: string
    operationId: string
    expectedStatuses: readonly MutationStatus[]
    nextStatus: MutationStatus
    response?: unknown
    errorCode?: string | null
  },
): Promise<boolean> {
  if (input.expectedStatuses.length === 0) {
    throw new InvalidIdempotencyInput('expectedStatuses must not be empty')
  }

  const placeholders = input.expectedStatuses.map(() => '?').join(', ')
  const responseJson = input.response === undefined
    ? null
    : serializeCanonical(input.response)

  const result = await env.DB.prepare(
    `UPDATE idempotency_records
        SET status = ?, response_json = ?, error_code = ?
      WHERE operation_scope = ?
        AND idempotency_key = ?
        AND operation_id = ?
        AND status IN (${placeholders})`,
  ).bind(
    input.nextStatus,
    responseJson,
    input.errorCode ?? null,
    input.operationScope,
    input.idempotencyKey,
    input.operationId,
    ...input.expectedStatuses,
  ).run()

  return (result.meta?.changes ?? 0) === 1
}

export function markMutationInProgress(
  env: IdempotencyEnv,
  input: Omit<Parameters<typeof updateStatus>[1], 'expectedStatuses' | 'nextStatus'>,
): Promise<boolean> {
  return updateStatus(env, {
    ...input,
    expectedStatuses: ['CLAIMED'],
    nextStatus: 'IN_PROGRESS',
  })
}

export function completeMutation(
  env: IdempotencyEnv,
  input: Omit<Parameters<typeof updateStatus>[1], 'expectedStatuses' | 'nextStatus'> & {
    response: unknown
  },
): Promise<boolean> {
  return updateStatus(env, {
    ...input,
    expectedStatuses: ['CLAIMED', 'IN_PROGRESS'],
    nextStatus: 'SUCCEEDED',
  })
}

export function failMutation(
  env: IdempotencyEnv,
  input: Omit<Parameters<typeof updateStatus>[1], 'expectedStatuses' | 'nextStatus'> & {
    response: unknown
    errorCode: string
  },
): Promise<boolean> {
  return updateStatus(env, {
    ...input,
    expectedStatuses: ['CLAIMED', 'IN_PROGRESS'],
    nextStatus: 'FAILED',
  })
}

export function markMutationRecoveryRequired(
  env: IdempotencyEnv,
  input: Omit<Parameters<typeof updateStatus>[1], 'expectedStatuses' | 'nextStatus'> & {
    errorCode: string
  },
): Promise<boolean> {
  return updateStatus(env, {
    ...input,
    expectedStatuses: ['CLAIMED', 'IN_PROGRESS'],
    nextStatus: 'RECOVERY_REQUIRED',
  })
}
