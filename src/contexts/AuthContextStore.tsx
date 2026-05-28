import {
  AuthProvider,
  useAuth,
  isSupabaseConfigured,
} from "@/context/AuthProvider";

export { AuthProvider, useAuth, isSupabaseConfigured };

export const useAuthUser = () => useAuth().user;
export const useIsAdmin = () => false;
export const useAuthToken = () => useAuth().session?.access_token ?? null;
export const useIsDemoMode = () => useAuth().isDemoMode;
export const useAuthUnconfigured = () => useAuth().authUnconfigured;
