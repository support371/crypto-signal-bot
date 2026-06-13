# Privacy Policy

**Effective date:** June 13, 2026  
**App name:** CryptoOps Agent / crypto-signal-bot  
**Owner/contact:** CryptoOps Agent Project Administrator  
**Contact email:** Provided through the GPT/app owner profile

## 1. Overview

CryptoOps Agent / crypto-signal-bot is a real-time crypto operations, monitoring, signal, deployment, and system-status application. It may connect to services such as Cloudflare Workers, Cloudflare D1, Cloudflare R2, GitHub, Vercel, and public market-data providers to monitor system health, inspect deployments, review logs, check portfolio or paper-trading state, and support safe development of the application.

This Privacy Policy explains what information may be processed when you use the app, website, API, or connected GPT Actions.

## 2. Information We May Process

Depending on how the app is used, we may process:

- Operational requests you submit, such as commands to check system status, deployments, workflows, logs, or API health.
- Public market data requests, such as crypto symbols, prices, signals, and market-feed status.
- System and deployment metadata, such as GitHub commits, workflow runs, Vercel deployment status, Cloudflare Worker status, D1 database status, R2 bucket status, runtime mode, and error messages.
- Paper-trading or testing data, such as simulated trades, paper portfolio summaries, signal history, audit logs, Guardian status, and circuit-breaker status.
- Technical metadata, such as timestamps, API response status, endpoint paths, browser type, device type, and basic usage logs.
- Environment variable names or secret names when needed for diagnostics, but not secret values.

## 3. Information We Do Not Intentionally Collect

We do not intentionally collect or store:

- Real exchange API secret values in chat, public documents, logs, issues, pull requests, or frontend code.
- Private keys, seed phrases, wallet recovery phrases, or withdrawal credentials.
- Government ID numbers or sensitive identity documents.
- Payment card numbers.
- Unnecessary personal information.

If a real token, API key, private credential, or secret is accidentally pasted into the app, chat, logs, repository, or uploaded files, it should be treated as compromised and rotated immediately.

## 4. Connected Services and Third-Party Providers

The app may interact with third-party services, including:

- **OpenAI / ChatGPT** for GPT-based assistance and Actions.
- **Cloudflare** for Worker hosting, D1 database, R2 storage, logs, and runtime infrastructure.
- **GitHub** for repository inspection, file updates, issues, pull requests, commits, and workflow checks.
- **Vercel** for frontend deployment status, environment-variable inspection, and redeploy support.
- **Public market-data providers**, such as Coinbase/public market APIs, for read-only market prices.

These providers may process data according to their own privacy policies, terms, and security practices.

## 5. GPT Actions and Authentication

When GPT Actions are configured, authentication tokens are stored in the GPT Builder or platform authentication settings. Tokens should not be pasted into prompts, source code, public schemas, logs, or documentation.

The app is designed so Actions may inspect or operate connected services only within the permissions granted by the configured token. The app should not intentionally reveal token values or secret values to users.

## 6. How We Use Information

We use information to:

- Monitor backend and frontend health.
- Check runtime status, Guardian status, circuit breakers, market feed status, and deployment status.
- Diagnose app version drift, failed deployments, stale frontend builds, broken workflows, or backend errors.
- Maintain audit logs for operational events.
- Support paper-mode testing and controlled execution-readiness development.
- Improve reliability, safety, observability, and recovery workflows.
- Prevent unsafe execution, stale-data decisions, duplicate actions, and unauthorized mode changes.

## 7. Trading, Paper Mode, and Execution Mode

The current GPT Actions and public Worker API are designed for paper-mode testing, monitoring, deployment support, and read-only public market data. Live trading and withdrawals are not enabled through the current public GPT Actions.

During testing, paper mode is used for safe validation of signals, portfolio logic, risk controls, Guardian protection, circuit breakers, and deployment stability.

Any future real-time execution capability should be protected by explicit authorization, preflight checks, secure secret storage, risk limits, audit logging, kill switches, and rollback controls.

Withdrawals should require a separate guarded design and approval process.

## 8. Logs, Audit Records, and Retention

The app may store operational logs, audit records, paper-trading records, signal history, market snapshots, incident records, and deployment diagnostics.

Retention periods may vary depending on the storage provider and project configuration. Logs and records may be deleted, rotated, or archived when no longer needed for security, debugging, compliance, or operational reliability.

## 9. Security Practices

We use reasonable security practices for this type of system, including:

- Keeping secret values out of prompts, public files, logs, and frontend code.
- Using platform secret managers for tokens and credentials.
- Reporting secret names only, not secret values.
- Blocking or gating sensitive execution routes during testing.
- Auditing important runtime and mode-change events.
- Using Guardian checks, circuit breakers, risk limits, and rollback controls.
- Recommending immediate rotation of any credential accidentally exposed.

No system can be guaranteed completely secure.

## 10. Data Sharing

We do not sell personal information.

Information may be shared with connected service providers only as needed to operate the app, including OpenAI, Cloudflare, GitHub, Vercel, and market-data providers.

Information may also be disclosed if required by law, security investigation, platform abuse prevention, or to protect the rights and safety of the project, users, or service providers.

## 11. Cookies and Browser Storage

The frontend may use browser storage, cookies, or similar technologies for basic functionality such as remembering preferences, dashboard state, API base URL configuration, or session-related settings.

You can clear browser storage through your browser settings.

## 12. User Choices

You may request that operational data associated with your use be deleted where technically feasible and legally permitted.

You may also revoke connected service tokens directly through the relevant provider, such as GitHub, Cloudflare, Vercel, or OpenAI GPT Builder Action settings.

## 13. Children’s Privacy

This app is not intended for children under 13. We do not knowingly collect personal information from children under 13.

## 14. International Users

The app and connected services may process information in different countries depending on the infrastructure providers used.

## 15. Changes to This Policy

We may update this Privacy Policy as the app changes. The updated version will be posted at the same privacy-policy URL with a new effective date.

## 16. Contact

For privacy questions or requests, contact the CryptoOps Agent Project Administrator through the GPT/app owner profile or the configured project support channel.
