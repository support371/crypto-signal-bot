import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthProvider';
import { useAuth } from './context/AuthContext';
import { QueryClientProvider } from './providers/QueryClientProvider';
import Auth from './pages/Auth';
import Backtest from './pages/Backtest';
import Index from './pages/Index';
import Infrastructure from './pages/Infrastructure';
import IntegrationsStatus from './pages/IntegrationsStatus';
import NotFound from './pages/NotFound';
import Portfolio from './pages/Portfolio';
import PublicHome from './pages/PublicHome';
import Settings from './pages/Settings';
import Waitlist from './pages/Waitlist';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Loading secure dashboard…</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function ProtectedPage({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

export default function AppCore() {
  return (
    <QueryClientProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/waitlist" element={<Waitlist />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedPage>
                <Index />
              </ProtectedPage>
            }
          />
          <Route
            path="/backtest"
            element={
              <ProtectedPage>
                <Backtest />
              </ProtectedPage>
            }
          />
          <Route
            path="/portfolio"
            element={
              <ProtectedPage>
                <Portfolio />
              </ProtectedPage>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedPage>
                <Settings />
              </ProtectedPage>
            }
          />
          <Route
            path="/integrations"
            element={
              <ProtectedPage>
                <IntegrationsStatus />
              </ProtectedPage>
            }
          />
          <Route
            path="/infrastructure"
            element={
              <ProtectedPage>
                <Infrastructure />
              </ProtectedPage>
            }
          />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
