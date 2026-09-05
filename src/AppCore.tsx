import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthProvider';
import { useAuth } from './context/AuthContext';
import { useManagementAccess } from './hooks/useManagementAccess';
import { QueryClientProvider } from './providers/QueryClientProvider';

const Account = lazy(() => import('./pages/Account'));
const AdminCenter = lazy(() => import('./pages/AdminCenter'));
const Auth = lazy(() => import('./pages/Auth'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Index = lazy(() => import('./pages/Index'));
const Infrastructure = lazy(() => import('./pages/Infrastructure'));
const IntegrationsStatus = lazy(() => import('./pages/IntegrationsStatus'));
const NotFound = lazy(() => import('./pages/NotFound'));
const OperatorReadiness = lazy(() => import('./pages/OperatorReadiness'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const ProductionStatus = lazy(() => import('./pages/ProductionStatus'));
const PublicHome = lazy(() => import('./pages/PublicHome'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Settings = lazy(() => import('./pages/Settings'));
const Waitlist = lazy(() => import('./pages/Waitlist'));

function RouteLoading({ label = 'Loading application…' }: { label?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm text-muted-foreground">{label}</p>
    </main>
  );
}

function AccessFailure({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <div className="mt-4 flex gap-3 text-sm">
          <a href="/auth" className="underline">Sign in</a>
          <a href="/status" className="underline">Production status</a>
        </div>
      </div>
    </main>
  );
}

function AccessGate({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, isLoading, isDemoMode } = useAuth();
  const location = useLocation();
  const access = useManagementAccess();

  if (isLoading || (user && !isDemoMode && access.loading)) {
    return <RouteLoading label="Loading secure account authorization…" />;
  }

  if (!user) {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/auth" replace state={{ from: returnPath }} />;
  }

  if (isDemoMode) {
    if (admin) {
      return <AccessFailure title="Administrative access unavailable" detail="The certification demo identity can never receive administrative authority." />;
    }
    return children;
  }

  if (access.error) {
    return (
      <AccessFailure
        title="Account authorization unavailable"
        detail={`${access.error.message}${access.error.requestId ? ` Request: ${access.error.requestId}` : ''}`}
      />
    );
  }

  if (!access.isActive) {
    const status = access.data?.profile.status ?? 'UNKNOWN';
    return <AccessFailure title="Account access blocked" detail={`Account status is ${status}. Contact an authorized administrator.`} />;
  }

  if (admin && !access.canReadAdmin) {
    return <AccessFailure title="Permission denied" detail="Administrative access requires RISK_ADMIN, AUDITOR, or RELEASE_ADMIN authority." />;
  }

  return children;
}

function ProtectedPage({ children }: { children: ReactNode }) {
  return <AccessGate>{children}</AccessGate>;
}

function AdministrativePage({ children }: { children: ReactNode }) {
  return <AccessGate admin>{children}</AccessGate>;
}

export default function AppCore() {
  return (
    <QueryClientProvider>
      <AuthProvider>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<PublicHome />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/waitlist" element={<Waitlist />} />
            <Route path="/status" element={<ProductionStatus />} />
            <Route path="/dashboard" element={<ProtectedPage><Index /></ProtectedPage>} />
            <Route path="/backtest" element={<ProtectedPage><Backtest /></ProtectedPage>} />
            <Route path="/portfolio" element={<ProtectedPage><Portfolio /></ProtectedPage>} />
            <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
            <Route path="/account" element={<ProtectedPage><Account /></ProtectedPage>} />
            <Route path="/integrations" element={<ProtectedPage><IntegrationsStatus /></ProtectedPage>} />
            <Route path="/infrastructure" element={<ProtectedPage><Infrastructure /></ProtectedPage>} />
            <Route path="/operator-readiness" element={<ProtectedPage><OperatorReadiness /></ProtectedPage>} />
            {[
              '/admin',
              '/admin/users',
              '/admin/access',
              '/admin/sessions',
              '/admin/usage',
              '/admin/audit',
              '/admin/system',
            ].map((path) => (
              <Route
                key={path}
                path={path}
                element={<AdministrativePage><AdminCenter /></AdministrativePage>}
              />
            ))}
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
