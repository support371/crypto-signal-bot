import { createContext, useContext } from 'react';

export interface AuthBannerContextType {
  showBanner: boolean;
  triggerBanner: () => void;
  hideBanner: () => void;
}

export const AuthBannerContext = createContext<AuthBannerContextType | undefined>(undefined);

export function useAuthBanner() {
  const context = useContext(AuthBannerContext);
  if (!context) {
    throw new Error('useAuthBanner must be used within AuthBannerProvider');
  }
  return context;
}
