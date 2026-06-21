/**
 * Query Keys for TanStack Query
 * 
 * Centralized query keys for consistent caching and invalidation.
 */

// Re-export from backendTypes to keep a single source of truth
export {
  QueryKeys,
  type QueryKey,
} from './backendTypes';