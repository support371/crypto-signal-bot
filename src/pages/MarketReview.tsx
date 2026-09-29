import { Link } from 'react-router-dom';

const sources = [
  {
    name: 'FOREX.com',
    url: 'https://www.forex.com/',
    role: 'Your broker account and its available market research',
    status: 'Account connection not verified',
    detail: 'Instrument access, account entity, API permission, and any MT5 bridge must be verified for this specific account. US accounts do not offer cryptocurrency trading on FOREX.com.',
  },
  {
    name: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/markets/crypto/',
    role: 'Crypto market coverage and context',
    status: 'External reference only',
    detail: 'No licensed data feed or commercial redistribution permission has been configured in this application.',
  },
  {
    name: 'Investopedia',
    url: 'https://www.investopedia.com/cryptocurrency-4427699',
    role: 'Educational explanations and terminology',
    status: 'External reference only',
    detail: 'Educational articles can inform an original review; they are not trade signals or executable prices.',
  },
] as const;

export default function MarketReview() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-foreground">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Research workspace</p>
        <h1 className="mt-2 text-3xl font-bold">Market review sources</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          These are the intended research sources for GEM's market review. Listing a source does not
          connect an account, import licensed data, or authorize an order. Exchange prices and broker
          quotes must be separately verified before any execution decision.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {sources.map((source) => (
          <section key={source.name} className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{source.name}</h2>
            <p className="mt-2 text-sm">{source.role}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-700">{source.status}</p>
            <p className="mt-2 text-sm text-muted-foreground">{source.detail}</p>
            <a className="mt-4 inline-block text-sm font-medium underline" href={source.url} target="_blank" rel="noopener noreferrer">
              Open source
            </a>
          </section>
        ))}
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Before account integration</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Confirm which FOREX.com legal entity holds the account and which instruments it permits.</li>
          <li>Confirm account-specific API or MT5 access through the provider and keep credentials server-side.</li>
          <li>Record source URL and publication time for each original review; check data usage rights.</li>
          <li>Keep account orders unavailable until provider, risk, authorization, and reconciliation gates are verified.</li>
        </ul>
        <Link className="mt-4 inline-block text-sm font-medium underline" to="/integrations">View integration status</Link>
      </section>
    </main>
  );
}
