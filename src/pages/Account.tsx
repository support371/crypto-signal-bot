import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import { managementApi } from '@/lib/managementApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Account() {
  const { session, signOut, isDemoMode } = useAuth();
  const access = useManagementAccess();
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const profile = access.data?.profile;

  const roleLabel = useMemo(
    () => access.data?.roles.map((role) => `${role.role} · ${role.scope_type}:${role.scope_key}`).join(', ') || 'No privileged roles',
    [access.data?.roles],
  );

  const saveProfile = async () => {
    if (!session?.access_token || !displayName.trim()) return;
    setSaving(true);
    try {
      await managementApi.updateMe(session.access_token, displayName.trim());
      toast.success('Account profile updated.');
      setDisplayName('');
      await access.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (access.loading) {
    return <main className="min-h-screen bg-background p-8 text-foreground">Loading account authorization…</main>;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Account & security</p>
            <h1 className="mt-1 text-3xl font-bold">Your Crypto Signal Bot account</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Identity, account lifecycle, scoped access and session controls. Financial execution remains paper/testnet locked.
            </p>
          </div>
          <div className="flex gap-2">
            {access.canReadAdmin && <Button asChild variant="outline"><Link to="/admin">Admin</Link></Button>}
            <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>

        {access.error && !isDemoMode && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">
              Account authorization is unavailable: {access.error.message}
              {access.error.requestId ? ` · Request ${access.error.requestId}` : ''}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Email</span><div className="font-mono">{profile?.email ?? 'Not reported'}</div></div>
              <div><span className="text-muted-foreground">Actor ID</span><div className="break-all font-mono text-xs">{profile?.actor_id ?? 'Not available'}</div></div>
              <div><span className="text-muted-foreground">Status</span><div className="font-semibold">{profile?.status ?? 'UNKNOWN'}</div></div>
              <div><span className="text-muted-foreground">Account type</span><div>{profile?.account_type ?? 'UNKNOWN'}</div></div>
              {isDemoMode && <div className="rounded-md border p-3 text-xs">Demo identity only. It cannot receive administrative or financial authority.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Scoped access</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>{roleLabel}</div>
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                Roles never override paper mode, testnet, disabled mainnet, disabled withdrawals or provider-mutation locks.
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Current display name: {profile?.display_name ?? 'Not set'}</p>
            <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Display name"
                maxLength={160}
                disabled={isDemoMode || saving || !access.isActive}
              />
              <Button onClick={() => void saveProfile()} disabled={isDemoMode || saving || !displayName.trim() || !access.isActive}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Password & sessions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline"><Link to="/reset-password">Password recovery / change</Link></Button>
            <Button
              variant="outline"
              disabled={!session?.access_token || isDemoMode}
              onClick={() => {
                if (!session?.access_token) return;
                void managementApi.sessionEvent(session.access_token, 'SECURITY_REVIEWED')
                  .then(() => toast.success('Security review recorded.'))
                  .catch(() => toast.error('Could not record security review.'));
              }}
            >
              Record security review
            </Button>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="underline" to="/dashboard">Dashboard</Link>
          <Link className="underline" to="/status">Production status</Link>
          <Link className="underline" to="/operator-readiness">Operator readiness</Link>
        </div>
      </div>
    </main>
  );
}
