import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SetupRequired } from "./components/SetupRequired";
import { logFrontendEnvWarnings, shouldRenderSetupRequired } from "./lib/env";

const validation = logFrontendEnvWarnings();
const rootElement = document.getElementById("root");

function renderRootFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `
    <main style="min-height:100vh;background:#020617;color:#e2e8f0;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <section style="max-width:720px;border:1px solid rgba(248,113,113,.45);background:rgba(15,23,42,.96);border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.45)">
        <p style="text-transform:uppercase;letter-spacing:.24em;color:#fca5a5;font-size:12px;margin:0 0 12px">Root recovery</p>
        <h1 style="font-size:28px;margin:0 0 12px">Crypto Signal Bot failed to start</h1>
        <p style="line-height:1.6;color:#cbd5e1">The production bundle loaded, but startup failed before React could render. This fallback prevents the blank-screen failure mode.</p>
        <pre style="white-space:pre-wrap;background:rgba(0,0,0,.45);border-radius:12px;padding:16px;color:#fecaca;overflow:auto">${message}</pre>
        <button onclick="window.location.reload()" style="background:#22d3ee;color:#020617;border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer">Reload application</button>
      </section>
    </main>
  `;
}

try {
  if (!rootElement) {
    throw new Error("Missing #root element");
  }

  createRoot(rootElement).render(
    <ErrorBoundary>
      {shouldRenderSetupRequired(validation) ? <SetupRequired validation={validation} /> : <App />}
    </ErrorBoundary>
  );
} catch (error) {
  console.error("[runtime] root render failed", error);
  renderRootFallback(error);
}
