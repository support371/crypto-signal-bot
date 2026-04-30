import { FrontendEnvValidation } from '@/lib/env';

type SetupRequiredProps = {
  validation: FrontendEnvValidation;
};

export function SetupRequired({ validation }: SetupRequiredProps) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <section className="max-w-3xl rounded-2xl border border-amber-400/40 bg-slate-900/90 p-6 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.35em] text-amber-300">Deployment setup required</p>
        <h1 className="mt-3 text-3xl font-semibold">Crypto Signal Bot is deployed but not configured</h1>
        <p className="mt-3 text-sm text-slate-300">
          Vercel built the frontend successfully. The app needs production environment variables before it can render the dashboard safely.
        </p>

        <div className="mt-5 rounded-xl border border-slate-700 bg-black/30 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Missing or unsafe values</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
            {validation.missingRequired.map((item) => (
              <li key={item}><code className="text-amber-200">{item}</code></li>
            ))}
          </ul>
        </div>

        <div className="mt-5 rounded-xl border border-slate-700 bg-black/30 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Expected Vercel variables</h2>
          <pre className="mt-3 overflow-auto text-xs text-cyan-100">{`VITE_BACKEND_URL=https://your-backend.example.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-anon-key
# supported alias:
VITE_SUPABASE_ANON_KEY=your-public-anon-key`}</pre>
        </div>

        {validation.warnings.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-700 bg-black/30 p-4">
            <h2 className="text-sm font-semibold text-slate-100">Diagnostics</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
