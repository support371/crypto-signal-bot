/**
 * Query Client Provider
 * 
 * Provides TanStack Query client to the application with default configuration.
 */

import { QueryClient, QueryClientProvider as TanStackQueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

// Default query client configuration
const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
    mutations: {
      retry: 0,
    },
  },
});

// Query client for paper trading mode
const paperTradingQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30 * 1000, // 30 seconds for faster mock updates
      gcTime: 60 * 1000, // 1 minute
    },
    mutations: {
      retry: 0,
    },
  },
});

interface QueryClientProviderProps {
  children: React.ReactNode;
}

export function QueryClientProvider({ children }: QueryClientProviderProps) {
  const [queryClient] = useState(
    import.meta.env.VITE_PAPER_TRADING_MODE === 'true' 
      ? paperTradingQueryClient 
      : defaultQueryClient
  );

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </TanStackQueryClientProvider>
  );
}

export { QueryClient };
export default QueryClientProvider;