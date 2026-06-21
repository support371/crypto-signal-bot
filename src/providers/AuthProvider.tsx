/**
 * Authentication Provider
 * 
 * Provides authentication state and methods to the application.
 * In paper trading mode, authentication is always successful with a mock user.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '../lib/backendTypes';
import { Api } from '../lib/backend';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing session on mount
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      setIsLoading(true);
      const response = await Api.Auth.getCurrentUser();
      
      if (response.success && response.data) {
        setUser(response.data);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Session check failed:', err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await Api.Auth.signIn(email, password);
      
      if (response.success && response.data) {
        setUser(response.data);
      } else {
        setError(response.error || 'Sign in failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, username: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await Api.Auth.signUp(email, password, username);
      
      if (response.success && response.data) {
        setUser(response.data);
      } else {
        setError(response.error || 'Sign up failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      await Api.Auth.signOut();
      setUser(null);
    } catch (err) {
      console.error('Sign out failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const clearError = () => {
    setError(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    signIn,
    signUp,
    signOut,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthProvider;