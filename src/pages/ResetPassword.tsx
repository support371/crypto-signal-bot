import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { managementApi } from '@/lib/managementApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ResetPassword() {
  const navigate = useNavigate();
  const { user, session, requestPasswordReset, updatePassword, isDemoMode } = useAuth();
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const requestReset = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { error } = await requestPasswordReset(email.trim());
      if (error) throw error;
      toast.success('Password recovery email requested. Check your inbox.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to request password reset.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (password.length < 8) {
      toast.error('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      if (session?.access_token) {
        await managementApi.sessionEvent(session.access_token, 'PASSWORD_UPDATED').catch(() => undefined);
      }
      toast.success('Password updated.');
      navigate('/account', { replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to update password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Account security</p>
          <h1 className="mt-1 text-3xl font-bold">Password recovery</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Recovery and password changes are performed by the configured identity provider. No password is stored by Crypto Signal Bot.
          </p>
        </div>

        {isDemoMode && (
          <Card><CardContent className="pt-6 text-sm">Password management is unavailable for the certification demo identity.</CardContent></Card>
        )}

        <Card>
          <CardHeader><CardTitle>Request recovery email</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" disabled={busy || isDemoMode} />
            <Button onClick={() => void requestReset()} disabled={busy || isDemoMode || !email.trim()}>
              {busy ? 'Working…' : 'Send recovery email'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Set a new password</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Use this after opening the recovery link or when you already have an authenticated session.</p>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" disabled={busy || isDemoMode || !user} />
            <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" disabled={busy || isDemoMode || !user} />
            <Button onClick={() => void changePassword()} disabled={busy || isDemoMode || !user || !password || !confirmPassword}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </CardContent>
        </Card>

        <div className="flex gap-4 text-sm">
          <Link className="underline" to="/auth">Back to sign in</Link>
          {user && <Link className="underline" to="/account">Account</Link>}
        </div>
      </div>
    </main>
  );
}
