import React from 'react';

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[runtime] React render failure', error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <section className="max-w-2xl rounded-2xl border border-red-500/40 bg-slate-900/90 p-6 shadow-2xl">
          <p className="text-xs uppercase tracking-[0.35em] text-red-300">Runtime recovery</p>
          <h1 className="mt-3 text-3xl font-semibold">Crypto Signal Bot failed to render</h1>
          <p className="mt-3 text-sm text-slate-300">
            The deployment is live, but the browser hit a runtime error. The app is showing this recovery screen instead of a blank page.
          </p>
          <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-black/50 p-4 text-xs text-red-100">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <button
            className="mt-5 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
