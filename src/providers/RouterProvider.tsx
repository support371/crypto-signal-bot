/**
 * Router Provider
 * 
 * Provides routing utilities and navigation state to the application.
 */

import { createContext, useContext, ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

interface RouterContextType {
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  params: ReturnType<typeof useParams>;
  goBack: () => void;
  goForward: () => void;
}

const RouterContext = createContext<RouterContextType | undefined>(undefined);

interface RouterProviderProps {
  children: ReactNode;
}

export function RouterProvider({ children }: RouterProviderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const goBack = () => navigate(-1);
  const goForward = () => navigate(1);

  const value: RouterContextType = {
    location,
    navigate,
    params,
    goBack,
    goForward,
  };

  return (
    <RouterContext.Provider value={value}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): RouterContextType {
  const context = useContext(RouterContext);
  if (context === undefined) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
}

export default RouterProvider;