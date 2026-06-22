import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from './providers/QueryClientProvider';
import { AuthProvider } from './providers/AuthProvider';
import { UserProvider } from './providers/UserProvider';
import { WebSocketProvider } from './providers/WebSocketProvider';
import Layout from './components/Layout';
import LoadingScreen from './components/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import SetupRequiredScreen from './components/SetupRequiredScreen';
import Toast from './components/Toast';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Signals = lazy(() => import('./pages/Signals'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Trading = lazy(() => import('./pages/Trading'));
const Settings = lazy(() => import('./pages/Settings'));
const History = lazy(() => import('./pages/History'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Backtesting = lazy(() => import('./pages/Backtesting'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Notifications = lazy(() => import('./pages/Notifications'));
const ExchangeConnections = lazy(() => import('./pages/ExchangeConnections'));
const PaperTrading = lazy(() => import('./pages/PaperTrading'));
const Infrastructure = lazy(() => import('./pages/Infrastructure'));
const Admin = lazy(() => import('./pages/Admin'));
const SignIn = lazy(() => import('./pages/SignIn'));
const SignUp = lazy(() => import('./pages/SignUp'));

export default function AppCore() {
  return (
    <ErrorBoundary>
      <QueryClientProvider>
        <AuthProvider>
          <UserProvider>
            <WebSocketProvider>
              <Toast />
              <Suspense fallback={<LoadingScreen />}>
                <Routes>
                  <Route path="/signin" element={<SignIn />} />
                  <Route path="/signup" element={<SignUp />} />
                  <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="signals" element={<Signals />} />
                    <Route path="portfolio" element={<Portfolio />} />
                    <Route path="trading" element={<Trading />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="history" element={<History />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="backtesting" element={<Backtesting />} />
                    <Route path="alerts" element={<Alerts />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="exchanges" element={<ExchangeConnections />} />
                    <Route path="paper-trading" element={<PaperTrading />} />
                    <Route path="infrastructure" element={<Infrastructure />} />
                    <Route path="admin" element={<Admin />} />
                  </Route>
                  <Route path="/setup" element={<SetupRequiredScreen />} />
                  <Route path="*" element={<Dashboard />} />
                </Routes>
              </Suspense>
            </WebSocketProvider>
          </UserProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
