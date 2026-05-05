import { Link } from "react-router-dom";

export default function PublicHome() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="mb-4 text-4xl font-bold">Crypto Signal Bot</h1>
      <p className="mb-6 text-muted-foreground">
        Public entry point for product information, provider status, and early access registration.
      </p>
      <nav className="grid gap-4 sm:grid-cols-2">
        <Link className="rounded border p-4 hover:bg-muted" to="/integrations">
          <h2 className="font-semibold">Integration Status</h2>
          <p className="text-sm text-muted-foreground">View current provider readiness.</p>
        </Link>
        <Link className="rounded border p-4 hover:bg-muted" to="/waitlist">
          <h2 className="font-semibold">Join the Waitlist</h2>
          <p className="text-sm text-muted-foreground">Register for product updates.</p>
        </Link>
      </nav>
    </main>
  );
}
