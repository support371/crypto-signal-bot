import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleDashed, CreditCard, ShieldCheck, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { fetchBackendJson } from '@/lib/backendRuntime';

type CheckValue = 'passed' | 'pending' | 'provider_managed' | string;

type PreflightResponse = {
  sessionId: string;
  partnerOrderId: string;
  statusToken: string;
  mode: 'sandbox' | 'production';
  liveFundingEnabled: boolean;
  callbackUrl: string;
  checks: Record<string, CheckValue>;
  feeQuote: Record<string, unknown> | null;
  widget: {
    scriptUrl: string;
    config: Record<string, unknown>;
  };
};

type StatusResponse = {
  order: {
    partner_order_id?: string;
    provider_status?: string;
    provider_substatus?: string | null;
    provider_error?: string | null;
    masked_card?: string | null;
    bank_authorization_status?: string;
    bank_second_factor_status?: string;
    card_verification_status?: string;
    payin_amount?: string;
    payin_currency?: string;
    payout_amount?: string | null;
    payout_currency?: string;
    updated_at?: string;
  };
  ts: number;
};

type SwitchereSdk = {
  init: (config: Record<string, unknown>) => void;
  debug?: boolean;
};

type SwitchereWindow = Window & typeof globalThis & {
  switchereSdk?: SwitchereSdk;
};

const defaultForm = {
  clientReference: '',
  clientCountry: 'US',
  payinAmount: '500',
  payinCurrency: 'EUR',
  payoutCurrency: 'BTC',
  dstAddress: '',
  memo: '',
  clientApproved: false,
  cardholderNameMatch: false,
  cardUsePermissionConfirmed: false,
};

function labelForCheck(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase());
}

function CheckIcon({ value }: { value: string }) {
  if (value === 'passed' || value === 'provider_verified') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  if (value === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-amber-500" />;
}

async function loadSwitchereSdk(scriptUrl: string): Promise<SwitchereSdk> {
  const targetWindow = window as SwitchereWindow;
  if (targetWindow.switchereSdk) return targetWindow.switchereSdk;

  const existing = document.querySelector<HTMLScriptElement>('script[data-switchere-sdk="true"]');
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Switchere SDK failed to load')), { once: true });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.dataset.switchereSdk = 'true';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Switchere SDK failed to load')), { once: true });
      document.head.appendChild(script);
    });
  }

  if (!targetWindow.switchereSdk) throw new Error('Switchere SDK is unavailable after loading');
  return targetWindow.switchereSdk;
}

export default function CardFunding() {
  const { user, session, isDemoMode } = useAuth();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(() => ({
    ...defaultForm,
    clientReference: user?.id ? `client-${user.id.slice(0, 24)}` : '',
  }));
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse['order'] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const returnResult = searchParams.get('result');
  const checkEntries = useMemo(() => {
    const checks: Record<string, string> = { ...(preflight?.checks ?? {}) };
    if (status) {
      checks.bankAuthorization = status.bank_authorization_status ?? 'pending';
      checks.bankSecondFactor = status.bank_second_factor_status ?? 'provider_managed';
      checks.cardVerification = status.card_verification_status ?? 'pending';
    }
    return Object.entries(checks);
  }, [preflight, status]);

  useEffect(() => {
    if (!preflight) return;
    let cancelled = false;

    (async () => {
      try {
        const sdk = await loadSwitchereSdk(preflight.widget.scriptUrl);
        if (cancelled) return;
        const mount = document.querySelector('#switchere-card-widget');
        if (!mount) throw new Error('Switchere widget mount is unavailable');
        mount.innerHTML = '';
        sdk.init({
          el: '#switchere-card-widget',
          ...preflight.widget.config,
        });
      } catch (error) {
        if (!cancelled) {
          setWidgetError(error instanceof Error ? error.message : 'Switchere widget failed to start');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preflight]);

  useEffect(() => {
    if (!preflight) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await fetchBackendJson<StatusResponse>(
          `/funding/switchere/status/${encodeURIComponent(preflight.partnerOrderId)}?token=${encodeURIComponent(preflight.statusToken)}`,
        );
        if (!cancelled) setStatus(result.order);
      } catch {
        // The signed provider callback may not have arrived yet.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [preflight]);

  const submitPreflight = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token || isDemoMode) {
      toast.error('A real authenticated client session is required');
      return;
    }

    setSubmitting(true);
    setWidgetError(null);
    setStatus(null);
    try {
      const result = await fetchBackendJson<PreflightResponse>('/funding/switchere/preflight', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ...form,
          clientEmail: user?.email,
          returnBaseUrl: window.location.origin,
          memo: form.memo || undefined,
        }),
      });
      setPreflight(result);
      toast.success('Card security preflight passed');
    } catch (error) {
      setPreflight(null);
      toast.error(error instanceof Error ? error.message : 'Card security preflight failed');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/70 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-2">
              <CreditCard className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Switchere Card Security Gateway</h1>
              <p className="text-xs text-muted-foreground">Hosted card entry, bank authorisation, verification and 3-D Secure state tracking</p>
            </div>
          </div>
          <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
        </div>
      </header>

      <div className="container mx-auto grid gap-6 px-4 py-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Security preflight</h2>
          </div>

          {returnResult && (
            <div className={`mb-4 rounded-lg border p-3 text-sm ${returnResult === 'success' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-destructive/40 bg-destructive/10'}`}>
              Switchere returned: <strong>{returnResult}</strong>
            </div>
          )}

          <form className="space-y-4" onSubmit={submitPreflight}>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Client reference</span>
              <input
                value={form.clientReference}
                onChange={(event) => updateField('clientReference', event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                required
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Country</span>
                <input
                  value={form.clientCountry}
                  onChange={(event) => updateField('clientCountry', event.target.value.toUpperCase())}
                  maxLength={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 uppercase"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Amount</span>
                <input
                  value={form.payinAmount}
                  onChange={(event) => updateField('payinAmount', event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  required
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Pay with</span>
                <input
                  value={form.payinCurrency}
                  onChange={(event) => updateField('payinCurrency', event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 uppercase"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Receive</span>
                <input
                  value={form.payoutCurrency}
                  onChange={(event) => updateField('payoutCurrency', event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 uppercase"
                  required
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Destination wallet address</span>
              <textarea
                value={form.dstAddress}
                onChange={(event) => updateField('dstAddress', event.target.value)}
                className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Memo or destination tag</span>
              <input
                value={form.memo}
                onChange={(event) => updateField('memo', event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>

            {([
              ['clientApproved', 'Client approved this specific purchase'],
              ['cardholderNameMatch', 'Cardholder name matches the authenticated client'],
              ['cardUsePermissionConfirmed', 'Client confirmed permission to use this card'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => updateField(key, event.target.checked)}
                  className="mt-1"
                />
                <span>{label}</span>
              </label>
            ))}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Running checks…' : 'Run checks and open secure card entry'}
            </button>
          </form>
        </section>

        <section className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 font-semibold">Verification state</h2>
            {checkEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Run the preflight to initialise the verification state.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {checkEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
                    <span>{labelForCheck(key)}</span>
                    <span className="flex items-center gap-2 font-mono text-xs">
                      <CheckIcon value={value} /> {value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {status?.provider_error && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {status.provider_error}
              </div>
            )}

            {status && (
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Provider status</dt><dd className="font-mono">{status.provider_status ?? 'pending'}</dd></div>
                <div><dt className="text-muted-foreground">Provider substatus</dt><dd className="font-mono">{status.provider_substatus ?? 'none'}</dd></div>
                <div><dt className="text-muted-foreground">Masked card</dt><dd className="font-mono">{status.masked_card ?? 'not returned'}</dd></div>
                <div><dt className="text-muted-foreground">Updated</dt><dd className="font-mono">{status.updated_at ?? 'pending'}</dd></div>
              </dl>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Secure card entry</h2>
              {preflight && <span className="rounded-full border border-border px-2 py-1 font-mono text-xs">{preflight.mode}</span>}
            </div>
            {widgetError && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {widgetError}
              </div>
            )}
            {!preflight && (
              <div className="flex min-h-96 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                The hosted card form opens here after all preflight rules pass.
              </div>
            )}
            <div id="switchere-card-widget" className={preflight ? 'min-h-[560px] w-full' : 'hidden'} />
          </div>
        </section>
      </div>
    </main>
  );
}
