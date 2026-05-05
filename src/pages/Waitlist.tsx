import React, { useState } from "react";
import { apiFetch } from "@/lib/api";

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/v1/waitlist", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage("You have been added to the waitlist.");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join waitlist");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-4 text-3xl font-bold">Join the Waitlist</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          placeholder="you@example.com"
          className="w-full rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {loading ? "Submitting..." : "Join Waitlist"}
        </button>
      </form>
      {message && <p className="mt-4 text-green-600">{message}</p>}
      {error && <p className="mt-4 text-red-600">{error}</p>}
    </main>
  );
}
