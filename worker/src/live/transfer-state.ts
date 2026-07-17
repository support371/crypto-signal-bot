export type DepositState =
  | 'DETECTED'
  | 'PENDING'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED'
  | 'RECOVERY_REQUIRED'

export type WithdrawalState =
  | 'REQUESTED'
  | 'SCREENING'
  | 'REJECTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'TIME_LOCKED'
  | 'PREVIEWING'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'

const DEPOSIT_TRANSITIONS: Readonly<Record<DepositState, readonly DepositState[]>> = {
  DETECTED: ['PENDING', 'CONFIRMING', 'COMPLETED', 'FAILED', 'RECOVERY_REQUIRED'],
  PENDING: ['CONFIRMING', 'COMPLETED', 'FAILED', 'RECOVERY_REQUIRED'],
  CONFIRMING: ['COMPLETED', 'FAILED', 'RECOVERY_REQUIRED'],
  COMPLETED: ['REVERSED', 'RECOVERY_REQUIRED'],
  FAILED: ['RECOVERY_REQUIRED'],
  REVERSED: ['RECOVERY_REQUIRED'],
  RECOVERY_REQUIRED: ['PENDING', 'CONFIRMING', 'COMPLETED', 'FAILED', 'REVERSED'],
}

const WITHDRAWAL_TRANSITIONS: Readonly<Record<WithdrawalState, readonly WithdrawalState[]>> = {
  REQUESTED: ['SCREENING', 'REJECTED', 'CANCELLED', 'FAILED'],
  SCREENING: ['REJECTED', 'PENDING_APPROVAL', 'FAILED', 'RECOVERY_REQUIRED'],
  REJECTED: [],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED'],
  APPROVED: ['TIME_LOCKED', 'PREVIEWING', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED'],
  TIME_LOCKED: ['PREVIEWING', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED'],
  PREVIEWING: ['SUBMITTING', 'REJECTED', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED'],
  SUBMITTING: ['SUBMITTED', 'FAILED', 'RECOVERY_REQUIRED'],
  SUBMITTED: ['CONFIRMING', 'COMPLETED', 'FAILED', 'RECOVERY_REQUIRED'],
  CONFIRMING: ['COMPLETED', 'FAILED', 'RECOVERY_REQUIRED'],
  COMPLETED: ['RECOVERY_REQUIRED'],
  CANCELLED: ['RECOVERY_REQUIRED'],
  FAILED: ['RECOVERY_REQUIRED'],
  RECOVERY_REQUIRED: ['SCREENING', 'PENDING_APPROVAL', 'APPROVED', 'TIME_LOCKED', 'PREVIEWING', 'SUBMITTED', 'CONFIRMING', 'COMPLETED', 'CANCELLED', 'FAILED'],
}

const TERMINAL_DEPOSIT_STATES = new Set<DepositState>([
  'COMPLETED',
  'FAILED',
  'REVERSED',
])

const TERMINAL_WITHDRAWAL_STATES = new Set<WithdrawalState>([
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
])

export class InvalidDepositTransition extends Error {
  readonly previousState: DepositState
  readonly requestedState: DepositState

  constructor(previousState: DepositState, requestedState: DepositState) {
    super(`Illegal deposit transition: ${previousState} -> ${requestedState}`)
    this.name = 'InvalidDepositTransition'
    this.previousState = previousState
    this.requestedState = requestedState
  }
}

export class InvalidWithdrawalTransition extends Error {
  readonly previousState: WithdrawalState
  readonly requestedState: WithdrawalState

  constructor(previousState: WithdrawalState, requestedState: WithdrawalState) {
    super(`Illegal withdrawal transition: ${previousState} -> ${requestedState}`)
    this.name = 'InvalidWithdrawalTransition'
    this.previousState = previousState
    this.requestedState = requestedState
  }
}

export function canTransitionDeposit(
  previousState: DepositState,
  nextState: DepositState,
): boolean {
  return DEPOSIT_TRANSITIONS[previousState].includes(nextState)
}

export function assertDepositTransition(
  previousState: DepositState,
  nextState: DepositState,
): void {
  if (!canTransitionDeposit(previousState, nextState)) {
    throw new InvalidDepositTransition(previousState, nextState)
  }
}

export function canTransitionWithdrawal(
  previousState: WithdrawalState,
  nextState: WithdrawalState,
): boolean {
  return WITHDRAWAL_TRANSITIONS[previousState].includes(nextState)
}

export function assertWithdrawalTransition(
  previousState: WithdrawalState,
  nextState: WithdrawalState,
): void {
  if (!canTransitionWithdrawal(previousState, nextState)) {
    throw new InvalidWithdrawalTransition(previousState, nextState)
  }
}

export function isDepositTerminal(state: DepositState): boolean {
  return TERMINAL_DEPOSIT_STATES.has(state)
}

export function isWithdrawalTerminal(state: WithdrawalState): boolean {
  return TERMINAL_WITHDRAWAL_STATES.has(state)
}

export function isWithdrawalProviderActive(state: WithdrawalState): boolean {
  return new Set<WithdrawalState>([
    'SUBMITTING',
    'SUBMITTED',
    'CONFIRMING',
    'RECOVERY_REQUIRED',
  ]).has(state)
}
