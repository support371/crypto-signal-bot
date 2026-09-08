import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function StateRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <div>
        <p className="font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
          ok ? 'border-accent/40 text-accent' : 'border-destructive/40 text-destructive'
        }`}
      >
        {ok ? 'PASS' : 'CHECK'}
      </span>
    </div>
  );
}

export default function AccessTest() {
  const { user, session, authUnconfigured, isDemoMode } = useAuth();
  const access = useManagementAccess();

  const hasSession = Boolean(user && session?.access_token);
  const managementResponded = isDemoMode || Boolean(access.data) || Boolean(access.error);
  const managementAccepted = isDemoMode || Boolean(access.data && !access.error);
  const accountActive = isDemoMode || Boolean(access.isActive);
  const hasRole = isDemoMode || access.roles.size > 0;
  const dashboardReachable = hasSession;

  const blocker = !hasSession
    ? 'No authenticated browser session is committed yet.'
    : authUnconfigured
      ? 'The production identity provider is not configured in this deployment.'
      : access.error
        ? `${access.error.code}: ${access.error.message}`
        : !accountActive
          ? `Account status is ${access.data?.profile.status ?? 'UNKNOWN'}.`
          : !hasRole
            ? 'The identity is valid, but no application role is assigned. The dashboard inspection surface is still allowed; privileged areas remain blocked.'
            : 'No dashboard-access blocker is detected by this test.';

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Access diagnostic</p>
          <h1 className="mt-1 text-3xl font-bold">Crypto dashboard access test</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page tests the exact browser-session and management gates used around the dashboard. It does not enable live trading, withdrawals, mainnet, or privileged administration.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Current access path</CardTitle>
          </CardHeader>
          <CardContent>
            <StateRow
              label="Browser identity session"
              ok={hasSession}
              detail={hasSession ? `Signed in as ${user?.email ?? user?.id ?? 'verified user'}.` : 'Sign-in has not produced a committed browser session.'}
            />
            <StateRow
              label="Identity provider configuration"
              ok={!authUnconfigured}
              detail={authUnconfigured ? 'Supabase identity configuration is unavailable to this deployment.' : 'Identity-provider configuration is present.'}
            />
            <StateRow
              label="Management API response"
              ok={managementResponded}
              detail={access.loading ? 'Management authorization is still loading.' : access.error ? `${access.error.code}: ${access.error.message}` : 'Management authorization returned a response.'}
            />
            <StateRow
              label="Management authorization"
              ok={managementAccepted}
              detail={access.error ? `Request ${access.error.requestId ?? 'without request id'} failed.` : 'The signed-in identity was accepted by the management plane.'}
            />
            <StateRow
              label="Account lifecycle"
              ok={accountActive}
              detail={`Status: ${access.data?.profile.status ?? (isDemoMode ? 'ACTIVE DEMO' : 'UNKNOWN')}.`}
            />
            <StateRow
              label="Application role"
              ok={hasRole}
              detail={hasRole ? `Roles: ${Array.from(access.roles).join(', ') || 'DEMO VIEWER'}.` : 'No role is assigned yet.'}
            />
            <StateRow
              label="Dashboard inspection route"
              ok={dashboardReachable}
              detail={dashboardReachable ? 'Authenticated dashboard inspection should be reachable even if management authorization is temporarily unavailable.' : 'Dashboard still requires an authenticated browser session.'}
            />
          </CardContent>
        </Card>

        <Card className={blocker.startsWith('No dashboard-access blocker') ? 'border-accent/40' : 'border-warning/50'}>
          <CardHeader><CardTitle>Result</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{blocker}</p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void access.refresh()} disabled={access.loading}>
                {access.loading ? 'Testing…' : 'Run test again'}
              </Button>
              <Button asChild variant="outline"><Link to="/dashboard">Open dashboard</Link></Button>
              <Button asChild variant="outline"><Link to="/account">Account & security</Link></Button>
              <Button asChild variant="ghost"><Link to="/status">Production status</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
