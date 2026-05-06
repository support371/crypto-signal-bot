import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Provider = {
  name: string;
  category: string;
  markets: string[];
  status: string;
  last_update_ts?: number | null;
};

export default function IntegrationsStatus() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ providers: Provider[] }>("/api/v1/integrations/status")
      .then((data) => setProviders(data.providers || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load status"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="p-8">Loading provider status...</main>;
  if (error) return <main className="p-8 text-red-600">{error}</main>;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-3xl font-bold">Integration Status</h1>
      <table className="w-full table-auto border-collapse">
        <thead>
          <tr className="border-b">
            <th className="py-2 text-left">Name</th>
            <th className="py-2 text-left">Category</th>
            <th className="py-2 text-left">Markets</th>
            <th className="py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((provider) => (
            <tr key={provider.name} className="border-b">
              <td className="py-2 font-medium">{provider.name}</td>
              <td className="py-2">{provider.category}</td>
              <td className="py-2">{provider.markets.join(", ")}</td>
              <td className="py-2">{provider.status || "unknown"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
