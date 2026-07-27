import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthProvider';
import { useAuth } from './context/AuthContext';
import { QueryClientProvider } from './providers/QueryClientProvider';

const Auth = lazy(() => import('./pages/Auth'));
const Backtest = lazy(() => import('./pages/Backtest'));
const CardFunding = lazy(() => import('./pages/CardFunding'));
const Index = lazy(() => import('./pages/Index'));
const Infrastructure = lazy(() => import('./pages/Infrastructure'));
const IntegrationsStatus = lazy(() => import('./pages/IntegrationsStatus'));
const NotFound = lazy(() => import('./pages/NotFound'));
const OperatorReadiness = lazy(() => import('./pages/OperatorReadiness'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const PublicHome = lazy(() => import('./pages/PublicHome'));
const Settings = lazy(() => import('./pages/Settings'));
const Waitlist = lazy(() => import('./pages/Waitlist'));

function RouteLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm text-muted-foreground">Loading application…</p>
    </main>
  );
}

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
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/auth" replace state={{ from: returnPath }} />;
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
        <Suspense fallback={<RouteLoading />}>
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
              path="/card-funding"
              element={
                <ProtectedPage>
                  <CardFunding />
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
            <Route
              path="/operator-readiness"
              element={
                <ProtectedPage>
                  <OperatorReadiness />
                </ProtectedPage>
              }
            />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
