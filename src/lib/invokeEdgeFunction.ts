import { supabase } from '@/integrations/supabase/client';
import { handleAuthError } from '@/lib/handleAuthError';

interface InvokeOptions {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface InvokeResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * Centralized Edge Function invoker with automatic auth token handling and error processing.
 * - Fetches the latest session token before each call
 * - Attaches Authorization header automatically
 * - Processes 401 errors via handleAuthError (triggers auth banner)
 */
export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  options: InvokeOptions = {}
): Promise<InvokeResult<T>> {
  try {
    // Always fetch the freshest token (auto-refresh may update without React re-rendering)
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;

    if (!accessToken) {
      // No session - trigger auth banner and return early
      handleAuthError(new Error('401: No active session'));
      return { data: null, error: new Error('Not authenticated') };
    }

    const { data, error: fnError } = await supabase.functions.invoke(functionName, {
      body: options.body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });

    if (fnError) {
      throw new Error(fnError.message);
    }

    return { data: data as T, error: null };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Handle 401 errors centrally
    if (handleAuthError(error)) {
      return { data: null, error };
    }

    return { data: null, error };
  }
}
