import { BackendStatusCard } from '@/components/BackendStatusCard';
import { ExchangeStatusCard } from '@/components/ExchangeStatusCard';

export default function Health() {
  return (
    <main className="min-h-screen bg-background p-6 font-mono">
      <h1 className="text-2xl font-bold mb-4">System Health</h1>
      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        <BackendStatusCard />
        <ExchangeStatusCard />
      </div>
    </main>
  );
}
