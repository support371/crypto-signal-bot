/**
 * Checks if an error is a 401 authentication error.
 * Returns true if it was a 401 error (caller should handle gracefully).
 */
export function isAuthError(error: unknown): boolean {
  const anyErr = error as any;
  const status: number | undefined =
    (typeof anyErr?.status === 'number' && anyErr.status) ||
    (typeof anyErr?.context?.status === 'number' && anyErr.context.status);

  const message = error instanceof Error ? error.message : String(error);

  return (
    status === 401 ||
    message.includes('401') ||
    message.includes('Invalid token') ||
    message.includes('Invalid JWT') ||
    message.includes('Unauthorized')
  );
}

// Callback to trigger the auth banner (set by AuthBannerContext)
let triggerAuthBannerFn: (() => void) | null = null;

export function setAuthBannerTrigger(fn: (() => void) | null) {
  triggerAuthBannerFn = fn;
}

/**
 * Checks if an error is a 401 authentication error and triggers the auth banner.
 * Returns true if it was a 401 error (caller should handle gracefully).
 */
export function handleAuthError(error: unknown): boolean {
  if (!isAuthError(error)) return false;

  if (triggerAuthBannerFn) {
    triggerAuthBannerFn();
  }

  return true;
}
