import { Link } from "react-router-dom";

export default function PublicHome() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="mb-4 text-4xl font-bold">Crypto Signal Bot</h1>
      <p className="mb-6 text-muted-foreground">
        Public entry point for product information, certification status, and early access registration.
      </p>
      <Link
        className="mb-6 inline-flex rounded bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90"
        to="/certification"
      >
        Open certification overview
      </Link>
      <nav className="grid gap-4 sm:grid-cols-3">
        <Link className="rounded border p-4 hover:bg-muted" to="/certification">
          <h2 className="font-semibold">Platform Status</h2>
          <p className="text-sm text-muted-foreground">See what is available, blocked, and still being built.</p>
        </Link>
        <a className="rounded border p-4 hover:bg-muted" href="/browser-network-diagnostic.html">
          <h2 className="font-semibold">Network Diagnostic</h2>
          <p className="text-sm text-muted-foreground">Compare the platform server path with this browser&apos;s Worker path.</p>
        </a>
        <Link className="rounded border p-4 hover:bg-muted" to="/waitlist">
          <h2 className="font-semibold">Join the Waitlist</h2>
          <p className="text-sm text-muted-foreground">Register for product updates.</p>
        </Link>
      </nav>
    </main>
  );
}
