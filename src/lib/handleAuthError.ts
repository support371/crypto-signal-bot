import { toast } from 'sonner';

/**
 * Checks if an error is a 401 authentication error and shows a user-friendly toast.
 * Returns true if it was a 401 error (caller should handle gracefully).
 */
export function handleAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  
  const is401 = 
    message.includes('401') ||
    message.includes('Invalid token') ||
    message.includes('Invalid JWT') ||
    message.includes('Unauthorized');

  if (is401) {
    toast.error('Session expired or not logged in', {
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

  return false;
}
