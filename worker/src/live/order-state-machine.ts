import type { OrderState } from './domain'

const TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  REQUESTED: ['VALIDATING', 'FAILED'],
  VALIDATING: ['VALIDATED', 'RISK_REJECTED', 'FAILED', 'RECOVERY_REQUIRED'],
  VALIDATED: ['RISK_APPROVED', 'RISK_REJECTED', 'FAILED', 'RECOVERY_REQUIRED'],
  RISK_REJECTED: [],
  RISK_APPROVED: ['RESERVING', 'FAILED', 'RECOVERY_REQUIRED'],
  RESERVING: ['RESERVED', 'FAILED', 'RECOVERY_REQUIRED'],
  RESERVED: ['PREVIEWING', 'SUBMITTING', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED'],
  PREVIEWING: ['PREVIEW_REJECTED', 'SUBMITTING', 'FAILED', 'RECOVERY_REQUIRED'],
  PREVIEW_REJECTED: ['CANCELLED', 'FAILED'],
  SUBMITTING: ['SUBMITTED', 'REJECTED', 'FAILED', 'RECOVERY_REQUIRED'],
  SUBMITTED: ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'REJECTED', 'EXPIRED', 'RECOVERY_REQUIRED'],
  OPEN: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED', 'RECOVERY_REQUIRED'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED', 'RECOVERY_REQUIRED'],
  FILLED: ['SETTLED', 'RECOVERY_REQUIRED'],
  CANCEL_REQUESTED: ['CANCEL_PENDING', 'CANCELLED', 'PARTIALLY_FILLED', 'FILLED', 'RECOVERY_REQUIRED'],
  CANCEL_PENDING: ['CANCELLED', 'PARTIALLY_FILLED', 'FILLED', 'RECOVERY_REQUIRED'],
  CANCELLED: ['SETTLED', 'RECOVERY_REQUIRED'],
  REJECTED: ['SETTLED', 'RECOVERY_REQUIRED'],
  EXPIRED: ['SETTLED', 'RECOVERY_REQUIRED'],
  FAILED: ['RECOVERY_REQUIRED'],
  RECOVERY_REQUIRED: ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED', 'SETTLED'],
  SETTLED: [],
}

const TERMINAL_STATES = new Set<OrderState>(['RISK_REJECTED', 'SETTLED'])
const EXCHANGE_ACTIVE_STATES = new Set<OrderState>([
  'SUBMITTING',
  'SUBMITTED',
  'OPEN',
  'PARTIALLY_FILLED',
  'CANCEL_REQUESTED',
  'CANCEL_PENDING',
  'RECOVERY_REQUIRED',
])

export class InvalidOrderTransition extends Error {
  readonly previousState: OrderState
  readonly requestedState: OrderState

  constructor(previousState: OrderState, requestedState: OrderState) {
    super(`Illegal order transition: ${previousState} -> ${requestedState}`)
    this.name = 'InvalidOrderTransition'
    this.previousState = previousState
    this.requestedState = requestedState
  }
}

export function allowedOrderTransitions(state: OrderState): readonly OrderState[] {
  return TRANSITIONS[state]
}

export function canTransitionOrder(previousState: OrderState, nextState: OrderState): boolean {
  return TRANSITIONS[previousState].includes(nextState)
}

export function assertOrderTransition(previousState: OrderState, nextState: OrderState): void {
  if (!canTransitionOrder(previousState, nextState)) {
    throw new InvalidOrderTransition(previousState, nextState)
  }
}

export function isOrderTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isOrderExchangeActive(state: OrderState): boolean {
  return EXCHANGE_ACTIVE_STATES.has(state)
}
