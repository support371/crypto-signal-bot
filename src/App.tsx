import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthProvider";
import { AuthBannerProvider } from "@/contexts/AuthBannerContext";
import { AuthBanner } from "@/components/AuthBanner";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";

const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PublicHome = lazy(() => import("./pages/PublicHome"));
const IntegrationsStatus = lazy(() => import("./pages/IntegrationsStatus"));
const Waitlist = lazy(() => import("./pages/Waitlist"));
const Backtest = lazy(() => import("./pages/Backtest"));
const Positions = lazy(() => import("./pages/Positions"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Guardian = lazy(() => import("./pages/Guardian"));
const Audit = lazy(() => import("./pages/Audit"));
const Health = lazy(() => import("./pages/Health"));
const Settings = lazy(() => import("./pages/Settings"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

const queryClient = new QueryClient();

const RouteLoadingShell = () => (
  <div className="min-h-screen bg-background scanlines flex items-center justify-center">
    <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-accent" />
      <span>Loading control center...</span>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AuthBannerProvider>
            <AuthBanner />
            <Suspense fallback={<RouteLoadingShell />}>
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<PublicHome />} />
                <Route path="/public" element={<PublicHome />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/integrations" element={<IntegrationsStatus />} />
                <Route path="/waitlist" element={<Waitlist />} />

                {/* Protected routes */}
                <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                <Route path="/positions" element={<ProtectedRoute><Positions /></ProtectedRoute>} />
                <Route path="/portfolio" element={<ProtectedRoute><Portfolio /></ProtectedRoute>} />
                <Route path="/guardian" element={<ProtectedRoute><Guardian /></ProtectedRoute>} />
                <Route path="/audit" element={<ProtectedRoute><Audit /></ProtectedRoute>} />
                <Route path="/health" element={<ProtectedRoute><Health /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/backtest" element={<ProtectedRoute><Backtest /></ProtectedRoute>} />

                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthBannerProvider>
        </AuthProvider>
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
