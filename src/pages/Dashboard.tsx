/**
 * /dashboard — authenticated main dashboard (alias for Index routing).
 * Keeps /dashboard route clean while reusing the full Index panel layout.
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const Index = lazy(() => import("./Index"));

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      }
    >
      <Index />
    </Suspense>
  );
}
