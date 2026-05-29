import { useAuth } from "@/context/AuthContext";

export { useAuth, isSupabaseConfigured } from "@/context/AuthContext";

export const useAuthUser = () => useAuth().user;
export const useIsAdmin = () => false;
export const useAuthToken = () => useAuth().session?.access_token ?? null;
export const useIsDemoMode = () => useAuth().isDemoMode;
export const useAuthUnconfigured = () => useAuth().authUnconfigured;
