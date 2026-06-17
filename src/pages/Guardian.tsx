import { GuardianBlockList } from '@/components/GuardianBlockList';
import { SafeModePanel } from '@/components/SafeModePanel';

export default function Guardian() {
  return (
    <main className="min-h-screen bg-background p-6 font-mono">
      <h1 className="text-2xl font-bold mb-4">Guardian</h1>
      <div className="space-y-4 max-w-xl">
        <SafeModePanel />
        <GuardianBlockList />
      </div>
    </main>
  );
}
