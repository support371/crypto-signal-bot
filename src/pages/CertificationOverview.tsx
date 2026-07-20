import { Link } from 'react-router-dom';
import { validateFrontendEnv } from '../lib/env';

type StatusTone = 'available' | 'blocked' | 'pending';

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const classes: Record<StatusTone, string> = {
    available: 'bg-emerald-100 text-emerald-800',
    blocked: 'bg-amber-100 text-amber-900',
    pending: 'bg-secondary-100 text-secondary-700',
  };

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>
      {label}
    </span>
  );
}

const BUILT_ITEMS = [
  'Public Certification Mode web interface and mobile-responsive application shell.',
  'Risk, accounting, reconciliation, recovery, audit, and operational-readiness contracts.',
  'Read-only provider normalization and source-only certification foundations.',
  'Eight-resource operator readiness model with minimized responses and permanent capability locks.',
  'Bounded server-side operator identity gateway foundation with fail-closed tests.',
  'Repository validation covering frontend builds, Worker contracts, migrations, and static safety rules.',
] as const;

const REMAINING_ITEMS = [
  'Configure an approved authentication provider for protected user and operator routes.',
  'Connect the server-side identity gateway to verified sessions, roles, and account scope.',
  'Deploy and configure the read-only backend services required by the full dashboard.',
  'Complete external provider attestations, infrastructure review, and independent release approval.',
  'Keep all execution, funding, withdrawal, and activation capabilities disabled until separately authorized.',
] as const;

export default function CertificationOverview() {
  const environment = validateFrontendEnv();
  const backendConfigured = Boolean(environment.backendUrl);

  return (
    <main className="min-h-screen bg-secondary-50 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-secondary-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold text-secondary-900">Certification Overview</h1>
                <StatusPill label="public read-only access" tone="available" />
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-secondary-600">
                This page is intentionally independent of sign-in and backend availability. It explains the current
                platform state without attempting to authorize an operator, connect exchange credentials, or perform
                any financial operation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/"
                className="rounded-lg border border-secondary-200 bg-white px-4 py-2 text-sm font-semibold text-secondary-700 transition hover:bg-secondary-50"
              >
                Public home
              </Link>
              <Link
                to="/waitlist"
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
              >
                Join waitlist
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Public application</p>
            <div className="mt-3"><StatusPill label="available" tone="available" /></div>
            <p className="mt-3 text-sm text-secondary-600">Landing, waitlist, and this overview require no sign-in.</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Dashboard backend</p>
            <div className="mt-3">
              <StatusPill label={backendConfigured ? 'configured' : 'not configured'} tone={backendConfigured ? 'available' : 'blocked'} />
            </div>
            <p className="mt-3 text-sm text-secondary-600">The full dashboard depends on a separately deployed backend.</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">User authentication</p>
            <div className="mt-3">
              <StatusPill label={environment.supabaseConfigured ? 'configured' : 'not configured'} tone={environment.supabaseConfigured ? 'available' : 'blocked'} />
            </div>
            <p className="mt-3 text-sm text-secondary-600">Protected routes remain unavailable without approved authentication.</p>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">Operator gateway</p>
            <div className="mt-3"><StatusPill label="foundation only" tone="pending" /></div>
            <p className="mt-3 text-sm text-secondary-600">The production operator endpoint remains disconnected and fail-closed.</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-secondary-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-secondary-900">What has been built</h2>
            <ul className="mt-4 space-y-3">
              {BUILT_ITEMS.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-secondary-700">
                  <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-secondary-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-secondary-900">What still remains</h2>
            <ul className="mt-4 space-y-3">
              {REMAINING_ITEMS.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-secondary-700">
                  <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-secondary-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-secondary-900">Route map</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-secondary-200 text-xs uppercase tracking-wide text-secondary-500">
                  <th className="px-3 py-3">Route</th>
                  <th className="px-3 py-3">Purpose</th>
                  <th className="px-3 py-3">Current access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100 text-secondary-700">
                <tr><td className="px-3 py-3 font-mono">/</td><td className="px-3 py-3">Public landing</td><td className="px-3 py-3"><StatusPill label="available" tone="available" /></td></tr>
                <tr><td className="px-3 py-3 font-mono">/certification</td><td className="px-3 py-3">Read-only build and readiness overview</td><td className="px-3 py-3"><StatusPill label="available" tone="available" /></td></tr>
                <tr><td className="px-3 py-3 font-mono">/waitlist</td><td className="px-3 py-3">Product updates registration</td><td className="px-3 py-3"><StatusPill label="available" tone="available" /></td></tr>
                <tr><td className="px-3 py-3 font-mono">/dashboard</td><td className="px-3 py-3">Full connected dashboard</td><td className="px-3 py-3"><StatusPill label="authentication required" tone="blocked" /></td></tr>
                <tr><td className="px-3 py-3 font-mono">/operator-readiness</td><td className="px-3 py-3">Server-authorized operator evidence</td><td className="px-3 py-3"><StatusPill label="identity gateway required" tone="blocked" /></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {environment.warnings.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
            <h2 className="font-semibold">Environment notices</h2>
            <ul className="mt-2 space-y-1">
              {environment.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
