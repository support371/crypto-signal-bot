/**
 * Supabase Client Configuration
 * 
 * This module provides the Supabase client instance for the application.
 * In paper trading mode, it returns a mock client that uses local storage.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { getRuntimeConfig } from './runtimeConfig';

// Supabase client instance
let supabaseClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Supabase client
 */
export function initializeSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  // In paper trading mode, use mock credentials
  const runtimeConfig = getRuntimeConfig();
  
  if (runtimeConfig.paperTradingMode) {
    // Mock Supabase client for paper trading
    console.log('[Supabase] Using mock client for paper trading mode');
    
    // Create a client with mock URL and key
    supabaseClient = createClient(
      env.supabaseUrl || 'https://mock-supabase-url.supabase.co',
      env.supabaseAnonKey || 'mock-supabase-key'
    );
    
    return supabaseClient;
  }

  // Production client
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error('Supabase URL and Anon Key are required in production mode');
  }

  supabaseClient = createClient(
    env.supabaseUrl,
    env.supabaseAnonKey
  );

  return supabaseClient;
}

/**
 * Get Supabase client instance
 */
export function getSupabaseClient() {
  if (!supabaseClient) {
    return initializeSupabaseClient();
  }
  return supabaseClient;
}

/**
 * Reset Supabase client (for testing)
 */
export function resetSupabaseClient() {
  supabaseClient = null;
}

// Initialize on import
initializeSupabaseClient();

// Export the client
export const supabase = getSupabaseClient();