import { toast } from 'sonner';

/**
 * Checks if an error is a 401 authentication error and shows a user-friendly toast.
 * Returns true if it was a 401 error (caller should handle gracefully).
 */
export function handleAuthError(error: unknown): boolean {
  const anyErr = error as any;
  const status: number | undefined =
    (typeof anyErr?.status === 'number' && anyErr.status) ||
    (typeof anyErr?.context?.status === 'number' && anyErr.context.status);

  const message = error instanceof Error ? error.message : String(error);

  const is401 =
    status === 401 ||
    message.includes('401') ||
    message.includes('Invalid token') ||
    message.includes('Invalid JWT') ||
    message.includes('Unauthorized');

  if (!is401) return false;

  toast.error('Session expired or not logged in', {
    id: 'auth-required',
    description: 'Please sign in to continue.',
    action: {
      label: 'Sign In',
      onClick: () => {
        window.location.href = '/auth';
      },
    },
    duration: 8000,
  });

  return true;
}
