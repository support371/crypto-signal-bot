/**
 * Operator Boundary - Critical Safety Layer
 * 
 * This module enforces the operator boundary that blocks all live trading,
 * withdrawals, and privileged operations. It is the final safety check before
 * any operation reaches the exchange or database.
 * 
 * SECURITY: This boundary CANNOT be bypassed. All operations must pass through
 * these checks.
 */

import { getRuntimeConfig, isPaperTradingMode, isLiveTradingAllowed, areWithdrawalsAllowed } from './runtimeConfig';
import { PaperTradingError, LiveTradingBlockedError, WithdrawalBlockedError, PrivilegedOperationError } from './backendTypes';

// List of privileged operations that are always blocked
const PRIVILEGED_OPERATIONS = new Set([
  'create_order',
  'cancel_order',
  'modify_order',
  'withdraw',
  'transfer',
  'create_api_key',
  'delete_api_key',
  'update_api_key',
  'execute_trade',
  'batch_order',
  'margin_trade',
  'futures_trade',
]);

/**
 * Check if an operation is privileged and should be blocked
 */
export function isPrivilegedOperation(operation: string): boolean {
  return PRIVILEGED_OPERATIONS.has(operation.toLowerCase());
}

/**
 * Enforce operator boundary for any operation
 * This is the MAIN safety check that must be called before any operation
 */
export function enforceOperatorBoundary(operation: string, context: { isPaper?: boolean } = {}): void {
  const { isPaper = false } = context;
  
  // SAFETY: Paper trading mode is ALWAYS enforced
  if (!isPaperTradingMode() && !isPaper) {
    throw new PaperTradingError('Paper trading mode is enforced. All operations use mock data.');
  }
  
  // SAFETY: Live trading is ALWAYS blocked
  if (isPrivilegedOperation(operation) && !isLiveTradingAllowed()) {
    throw new LiveTradingBlockedError(
      `Operation '${operation}' is blocked. Live trading is disabled.`
    );
  }
  
  // SAFETY: Withdrawals are ALWAYS blocked
  if (operation.toLowerCase() === 'withdraw' && !areWithdrawalsAllowed()) {
    throw new WithdrawalBlockedError(
      'Withdrawals are disabled. This operation cannot be performed.'
    );
  }
  
  // SAFETY: All privileged operations are blocked
  if (isPrivilegedOperation(operation)) {
    throw new PrivilegedOperationError(
      `Privileged operation '${operation}' is blocked by operator boundary.`
    );
  }
}

/**
 * Enforce read-only boundary for queries
 */
export function enforceReadOnlyBoundary(operation: string): void {
  const readOnlyOperations = new Set([
    'get_balance',
    'get_positions',
    'get_orders',
    'get_trades',
    'get_signals',
    'get_market_data',
  ]);
  
  if (!readOnlyOperations.has(operation.toLowerCase())) {
    enforceOperatorBoundary(operation, { isPaper: true });
  }
}

/**
 * Check if an operation can proceed (for conditional UI rendering)
 */
export function canPerformOperation(operation: string): boolean {
  try {
    enforceOperatorBoundary(operation, { isPaper: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Operator boundary wrapper for async functions
 */
export async function withOperatorBoundary<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  enforceOperatorBoundary(operation, { isPaper: true });
  return fn();
}

/**
 * Get operator boundary status for display
 */
export function getOperatorBoundaryStatus() {
  return {
    paperTradingMode: isPaperTradingMode(),
    liveTradingAllowed: isLiveTradingAllowed(),
    withdrawalsAllowed: areWithdrawalsAllowed(),
    message: 'Operator boundary is active. All live trading and withdrawals are blocked.',
  };
}