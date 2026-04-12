import React, { useState, useCallback, useEffect } from 'react';
import { AuthBannerContext } from '@/contexts/AuthBannerContextStore';
import { setAuthBannerTrigger } from '@/lib/handleAuthError';

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
