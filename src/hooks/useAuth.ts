/**
 * useAuth Hook
 * 
 * Custom hook for accessing authentication state and methods.
 */

import { useAuth as useAuthProvider } from '../providers/AuthProvider';

export function useAuth() {
  return useAuthProvider();
}

export default useAuth;