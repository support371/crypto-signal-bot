/**
 * /settings — user / operator settings page (wraps SettingsModal content).
 */
import { Link } from "react-router-dom";
import { ArrowLeft, Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-mono">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        Open the settings modal from the dashboard header (gear icon) to configure backend URL,
        demo mode, signal thresholds, and display preferences.
      </p>
      <div className="mt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm hover:bg-muted transition-colors"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
