import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { getSupabaseClient, useAuth } from '@/context/AuthContext';
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
  const [emailChange, setEmailChange] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaLevel, setMfaLevel] = useState('unknown');
  const [factorId, setFactorId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const profile = access.data?.profile;
  const roleLabel = access.data?.roles
    .map((role) => `${role.role} · ${role.scope_type}:${role.scope_key}`)
    .join(', ') || 'No assigned application roles';

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

  const refreshMfa = useCallback(async () => {
    if (isDemoMode || !session?.access_token) return;
    try {
      const client = await getSupabaseClient();
      const [{ data: assurance }, { data: factors }] = await Promise.all([
        client.auth.mfa.getAuthenticatorAssuranceLevel(),
        client.auth.mfa.listFactors(),
      ]);
      setMfaLevel(assurance?.currentLevel ?? 'unknown');
      const verified = factors?.totp.find((factor) => factor.status === 'verified');
      if (verified) setFactorId(verified.id);
    } catch {
      setMfaLevel('unavailable');
    }
  }, [isDemoMode, session?.access_token]);

  useEffect(() => {
    void refreshMfa();
  }, [refreshMfa]);

  const beginTotpEnrollment = async () => {
    setMfaBusy(true);
    try {
      const client = await getSupabaseClient();
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Crypto Signal Bot administrator',
      });
      if (error) throw error;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
      toast.success('Authenticator enrollment started. Verify the current six-digit code.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to begin authenticator enrollment.');
    } finally {
      setMfaBusy(false);
    }
  };

  const verifyTotp = async () => {
    if (!factorId || !/^\d{6}$/.test(verificationCode)) return;
    setMfaBusy(true);
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: verificationCode });
      if (error) throw error;
      setVerificationCode('');
      setQrCode('');
      setTotpSecret('');
      await refreshMfa();
      toast.success('AAL2 administrator step-up is active for this session.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Authenticator verification failed.');
    } finally {
      setMfaBusy(false);
    }
  };

  const requestEmailChange = async () => {
    if (!emailChange.trim()) return;
    setSaving(true);
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.updateUser({ email: emailChange.trim() });
      if (error) throw error;
      setEmailChange('');
      toast.success('Email change requested. Confirm it through the identity-provider email.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to request email change.');
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
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
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
            </div>
            <div className="max-w-xl space-y-2 border-t pt-4">
              <p className="text-sm font-semibold">Change email</p>
              <p className="text-xs text-muted-foreground">Both the current and new address may require confirmation, according to the identity-provider policy.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input type="email" value={emailChange} onChange={(event) => setEmailChange(event.target.value)} placeholder="New email address" disabled={saving || isDemoMode} />
                <Button variant="outline" onClick={() => void requestEmailChange()} disabled={saving || isDemoMode || !emailChange.trim()}>Request change</Button>
              </div>
            </div>
            <div className="max-w-xl space-y-3 border-t pt-4">
              <div>
                <p className="text-sm font-semibold">Administrator step-up authentication</p>
                <p className="text-xs text-muted-foreground">Current assurance: <strong>{mfaLevel.toUpperCase()}</strong>. User, access and bootstrap mutations require AAL2.</p>
              </div>
              {!qrCode && mfaLevel !== 'aal2' && (
                <Button variant="outline" onClick={() => void beginTotpEnrollment()} disabled={mfaBusy || isDemoMode}>Enroll authenticator</Button>
              )}
              {qrCode && (
                <div className="space-y-3 rounded-lg border p-4">
                  <img src={qrCode} alt="Authenticator enrollment QR code" className="h-44 w-44 rounded bg-white p-2" />
                  <p className="break-all font-mono text-xs">Manual key: {totpSecret}</p>
                  <div className="flex gap-2">
                    <Input inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Six-digit code" />
                    <Button onClick={() => void verifyTotp()} disabled={mfaBusy || verificationCode.length !== 6}>Verify</Button>
                  </div>
                </div>
              )}
            </div>
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
