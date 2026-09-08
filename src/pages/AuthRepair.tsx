import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function readSessionMaterial(raw: string) {
  const candidate = raw.trim();
  if (!candidate) throw new Error('Paste the complete sign-in or recovery link.');

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('That is not a complete valid URL.');
  }

  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const accessToken = hash.get('access_token') ?? url.searchParams.get('access_token');
  const refreshToken = hash.get('refresh_token') ?? url.searchParams.get('refresh_token');
  const code = url.searchParams.get('code') ?? hash.get('code');

  return { accessToken, refreshToken, code };
}

export default function AuthRepair() {
  const navigate = useNavigate();
  const [rawLink, setRawLink] = useState('');
  const [busy, setBusy] = useState(false);

  const complete = async (candidate: string) => {
    const { accessToken, refreshToken, code } = readSessionMaterial(candidate);
    const client = await getSupabaseClient();

    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    } else if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      throw new Error('The link does not contain a usable Supabase session or authorization code. Request a fresh sign-in/recovery email and try that link.');
    }

    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) throw new Error('Supabase did not create a verified session from this link. Request a fresh link and try again.');

    setRawLink('');
    toast.success('Secure session restored. Opening dashboard…');
    navigate('/dashboard', { replace: true });
  };

  useEffect(() => {
    const current = window.location.href;
    if (!/[#?&](access_token|refresh_token|code)=/.test(current)) return;

    setBusy(true);
    void complete(current)
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Unable to restore this session.'))
      .finally(() => setBusy(false));
    // Run once for an auth callback URL. Supabase auth state will persist the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await complete(rawLink);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to restore this session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Repair dashboard sign-in</CardTitle>
          <CardDescription>
            Use this only when a Crypto Signal Bot Supabase email link opens a localhost address or another unusable callback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={submit} className="space-y-3">
            <label htmlFor="auth-repair-link" className="block text-sm font-medium">
              Complete Supabase sign-in or recovery link
            </label>
            <textarea
              id="auth-repair-link"
              value={rawLink}
              onChange={(event) => setRawLink(event.target.value)}
              placeholder="Paste the complete localhost or Supabase callback URL here"
              rows={5}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            />
            <Button type="submit" className="w-full" disabled={busy || !rawLink.trim()}>
              {busy ? 'Restoring secure session…' : 'Restore session and open dashboard'}
            </Button>
          </form>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            The pasted link is processed only in this browser. This page does not send the token to a Vercel API route, Worker endpoint, log, or repository.
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="underline" to="/auth">Back to sign in</Link>
            <Link className="underline" to="/status">Production status</Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
