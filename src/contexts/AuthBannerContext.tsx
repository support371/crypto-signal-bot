import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { setAuthBannerTrigger } from '@/lib/handleAuthError';

interface AuthBannerContextType {
  showBanner: boolean;
  triggerBanner: () => void;
  hideBanner: () => void;
}

const AuthBannerContext = createContext<AuthBannerContextType | undefined>(undefined);

export const useAuthBanner = () => {
  const context = useContext(AuthBannerContext);
  if (!context) {
    throw new Error('useAuthBanner must be used within AuthBannerProvider');
  }
  return context;
};

export const AuthBannerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showBanner, setShowBanner] = useState(false);

  const triggerBanner = useCallback(() => setShowBanner(true), []);
  const hideBanner = useCallback(() => setShowBanner(false), []);

  // Register the trigger function with the handleAuthError utility
  useEffect(() => {
    setAuthBannerTrigger(triggerBanner);
    return () => setAuthBannerTrigger(null);
  }, [triggerBanner]);

  return (
    <AuthBannerContext.Provider value={{ showBanner, triggerBanner, hideBanner }}>
      {children}
    </AuthBannerContext.Provider>
  );
};
