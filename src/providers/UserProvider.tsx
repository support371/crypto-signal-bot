/**
 * User Provider
 * 
 * Provides user preferences and settings to the application.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, UserPreferences } from '../lib/backendTypes';
import { useAuth } from './AuthProvider';

interface UserContextType {
  preferences: UserPreferences;
  setPreferences: (preferences: Partial<UserPreferences>) => void;
  updatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  isLoading: boolean;
}

const defaultPreferences: UserPreferences = {
  theme: 'system',
  language: 'en',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  notifications: {
    email: true,
    push: true,
    sms: false,
    telegram: false,
    discord: false,
    signalAlerts: true,
    priceAlerts: true,
    tradeNotifications: true,
  },
  dashboard: {
    defaultView: 'dashboard',
    widgets: [],
    layout: 'grid',
  },
};

const UserContext = createContext<UserContextType | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load user preferences when user changes
    if (user) {
      // In a real app, you would fetch preferences from the backend
      // For paper trading mode, we use default preferences
      setPreferences(user.preferences || defaultPreferences);
    } else {
      setPreferences(defaultPreferences);
    }
    setIsLoading(false);
  }, [user]);

  const handleSetPreferences = (updates: Partial<UserPreferences>) => {
    setPreferences(prev => ({ ...prev, ...updates }));
  };

  const handleUpdatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  const value: UserContextType = {
    preferences,
    setPreferences: handleSetPreferences,
    updatePreference: handleUpdatePreference,
    isLoading: isLoading || authLoading,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextType {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export default UserProvider;