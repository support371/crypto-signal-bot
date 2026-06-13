export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-12">
      <article className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-white/5 p-8 leading-7">
        <h1 className="text-4xl font-bold mb-4">CryptoOps Agent Privacy Policy</h1>
        <p className="text-slate-300">Effective Date: June 13, 2026</p>

        <h2 className="text-2xl font-semibold mt-8">Overview</h2>
        <p>
          CryptoOps Agent is a custom GPT assistant created to help monitor, inspect,
          test, diagnose, and operate the crypto-signal-bot project.
        </p>
        <p>
          The project is designed as a real-time crypto monitoring, signal, portfolio,
          deployment, and exchange-integration readiness system. Paper mode is used as
          the active safe testing mode while the system is developed, verified, and hardened.
        </p>

        <h2 className="text-2xl font-semibold mt-8">Data the Agent May Access</h2>
        <p>
          Depending on connected Actions and authorization, CryptoOps Agent may access
          backend health status, runtime configuration, Guardian status, circuit breakers,
          market feed status, public market prices, paper portfolio records, paper trade
          history, signal history, audit logs, Cloudflare D1/R2 metadata, GitHub repository
          files, commits, workflow runs, issues, pull requests, Vercel deployment metadata,
          Render diagnostics, and Telegram alert delivery status if configured.
        </p>

        <h2 className="text-2xl font-semibold mt-8">Secrets and Sensitive Data</h2>
        <p>
          CryptoOps Agent must not request, store, expose, log, commit, or display real
          secrets. Secrets must only be stored inside official platform secret managers or
          GPT Builder Action authentication settings.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Do not expose GitHub, Cloudflare, Vercel, Render, Telegram, Binance, Bitget, BTCC, or Coinbase private keys.</li>
          <li>Do not expose wallet private keys, seed phrases, withdrawal credentials, passwords, one-time passwords, or recovery codes.</li>
          <li>Use placeholders such as &lt;GITHUB_TOKEN&gt;, &lt;CF_API_TOKEN&gt;, &lt;VERCEL_TOKEN&gt;, and exchange testnet placeholders in docs and examples.</li>
        </ul>

        <h2 className="text-2xl font-semibold mt-8">Paper Mode and Exchange Safety</h2>
        <p>
          Paper mode is the current active safe testing mode. Future exchange integration
          may include Binance, Bitget, BTCC, Coinbase public market data, and other exchange
          adapters, but live execution must remain gated behind security, compliance,
          secret-management, Guardian, audit, and explicit approval controls.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Trading mode must remain paper during testing.</li>
          <li>Exchange mode must remain paper during testing.</li>
          <li>Mainnet execution must remain disabled during testing.</li>
          <li>Live trading and withdrawals must remain blocked during testing.</li>
          <li>Coinbase public market data may be used for read-only pricing.</li>
        </ul>

        <h2 className="text-2xl font-semibold mt-8">Third-Party Services</h2>
        <p>
          CryptoOps Agent may connect to GitHub, Cloudflare, Vercel, Render, Telegram,
          Coinbase public market data endpoints, and future exchange APIs for sandbox,
          testnet, or approved backend integration. Each service has its own privacy,
          security, and data-handling policies.
        </p>

        <h2 className="text-2xl font-semibold mt-8">Incident Handling</h2>
        <p>
          If a security issue is detected, CryptoOps Agent should stop unsafe operations,
          report the issue clearly, avoid exposing secret values, recommend token rotation
          if needed, recommend Guardian kill mode if trading safety is affected, provide a
          recovery checklist, and verify the fix through tool-confirmed evidence.
        </p>
      </article>
    </main>
  );
}
