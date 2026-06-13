# CryptoOps Agent Privacy Policy

Effective Date: June 13, 2026

## 1. Overview

CryptoOps Agent is a custom GPT assistant created to help monitor, inspect, test, diagnose, and operate the crypto-signal-bot project.

The project is designed as a real-time crypto monitoring, signal, portfolio, deployment, and exchange-integration readiness system. Paper mode is used as the active safe testing mode while the system is developed, verified, and hardened.

This Privacy Policy explains what information the assistant may access through configured Actions, how that information is used, and how secrets and sensitive project data must be handled.

## 2. Project Covered by This Policy

This policy applies to the CryptoOps Agent custom GPT and its connected project services, including:

- crypto-signal-bot frontend
- crypto-signal-bot backend Worker
- GitHub repository
- Cloudflare Worker, D1, and R2 resources
- Vercel deployments
- Optional Render diagnostics
- Optional Telegram alerting
- Future exchange connector architecture for Binance, Bitget, BTCC, Coinbase public data, and other exchange adapters

## 3. Data the Agent May Access

Depending on which Actions are connected and authorized, CryptoOps Agent may access:

- Backend health status
- Runtime configuration
- Paper-trading mode status
- Guardian status
- Circuit breaker status
- Market feed status
- Public market prices
- Paper portfolio records
- Paper trade history
- Signal history
- Audit logs
- Cloudflare D1 table metadata and records
- Cloudflare R2 bucket metadata
- GitHub repository files
- GitHub commits
- GitHub branches
- GitHub workflow runs
- GitHub issues and pull requests
- Vercel deployment metadata
- Vercel build and deployment status
- Render diagnostic status, if configured
- Telegram alert delivery status, if configured

The agent should only access information needed to perform the requested monitoring, diagnosis, testing, deployment, reporting, or project-support task.

## 4. Data the Agent Must Not Request or Store

CryptoOps Agent must not request, store, expose, log, commit, or display real secrets.

This includes:

- Real GitHub tokens
- Real Cloudflare API tokens
- Real Vercel tokens
- Real Render API keys
- Real Telegram bot tokens
- Real Binance API keys
- Real Bitget API keys
- Real BTCC API keys
- Real Coinbase private exchange keys
- Real wallet private keys
- Seed phrases
- Withdrawal credentials
- Banking credentials
- Passwords
- One-time passwords
- Recovery codes

Secrets must only be stored inside official platform secret managers or GPT Builder Action authentication settings.

## 5. Use of Placeholders

Documentation, code examples, schemas, and instructions must use placeholders only, such as:

- `<GITHUB_TOKEN>`
- `<CF_API_TOKEN>`
- `<VERCEL_TOKEN>`
- `<RENDER_API_KEY>`
- `<TELEGRAM_BOT_TOKEN>`
- `<TELEGRAM_CHAT_ID>`
- `<BINANCE_TESTNET_KEY>`
- `<BITGET_TESTNET_KEY>`
- `<BTCC_TESTNET_KEY>`

Real values must never be placed in public files, instructions, commits, logs, or chat messages.

## 6. Purpose of Data Use

CryptoOps Agent may use authorized project data to:

- Verify system health
- Confirm paper-safety status
- Monitor real-time market data
- Review trading signals
- Inspect paper portfolio state
- Diagnose backend issues
- Diagnose frontend issues
- Diagnose database issues
- Diagnose deployment issues
- Inspect GitHub workflows
- Inspect Vercel deployments
- Inspect Cloudflare resources
- Prepare fixes
- Apply fixes when authorized
- Generate audit reports
- Generate incident reports
- Generate Telegram alert drafts
- Verify that live trading and withdrawals remain blocked during testing
- Support future exchange connector readiness without exposing secrets

## 7. Paper Mode and Exchange Safety

The current active testing mode is paper mode.

During paper mode:

- Trading mode must remain paper.
- Exchange mode must remain paper.
- Mainnet execution must remain disabled.
- Live trading endpoints must remain blocked.
- Withdrawal endpoints must remain blocked.
- Public Coinbase market data may be used for read-only pricing.
- Real exchange execution keys must not be requested or used.

Future exchange integration may include Binance, Bitget, BTCC, Coinbase public data, and other exchange adapters, but live execution must remain gated behind security, compliance, secret-management, Guardian, audit, and explicit approval controls.

## 8. Third-Party Services

CryptoOps Agent may connect to third-party services through configured Actions, including:

- GitHub
- Cloudflare
- Vercel
- Render
- Telegram
- Coinbase public market data endpoints
- Future exchange APIs for sandbox, testnet, or approved backend integration

Each third-party service has its own privacy, security, and data-handling policies. CryptoOps Agent only uses these services for project-related monitoring, development, deployment, diagnostics, and operational support.

## 9. Security Practices

CryptoOps Agent should follow these security practices:

- Use least-privilege permissions where possible.
- Keep secrets out of instructions and repo files.
- Use official platform authentication settings.
- Use placeholders in code and documentation.
- Treat exposed tokens as compromised.
- Recommend token rotation if exposure occurs.
- Verify tool output before reporting success.
- Never claim access unless access is confirmed by an Action response.
- Never claim a deployment, commit, or fix succeeded unless verified by tool output.
- Keep audit logs for operational actions where supported.

## 10. Data Retention

CryptoOps Agent does not independently control the retention policies of GitHub, Cloudflare, Vercel, Render, Telegram, OpenAI, or other connected platforms.

Project data may remain stored in:

- GitHub repository history
- GitHub Actions logs
- Cloudflare logs
- Cloudflare D1 records
- Cloudflare R2 objects
- Vercel deployment logs
- Render logs
- Telegram chats
- GPT conversation history, depending on user and platform settings

Users should manage deletion, rotation, and retention directly through the relevant platform settings.

## 11. User Responsibilities

The project owner is responsible for:

- Providing only safe credentials through official auth settings
- Rotating any exposed token
- Reviewing production changes
- Confirming platform permissions
- Confirming legal and compliance readiness before live exchange execution
- Ensuring real exchange keys are stored only in secure secret managers
- Ensuring live trading is not enabled until the system has passed security, compliance, and operational review

## 12. Live Trading Limitation

CryptoOps Agent may help design, inspect, test, and prepare exchange integration architecture.

However, during current paper-mode development, it must not:

- Enable live trading
- Enable withdrawals
- Enable mainnet execution
- Request real live exchange keys
- Execute real-money orders
- Circumvent Guardian or circuit breaker protections

Any future move from paper mode to live execution must require separate review, secure backend secret handling, explicit approval, exchange-side verification, compliance review, and production safety checks.

## 13. Incident Handling

If a security issue is detected, CryptoOps Agent should:

- Stop unsafe operations
- Report the issue clearly
- Avoid exposing secret values
- Recommend token rotation if needed
- Recommend Guardian kill mode if trading safety is affected
- Provide a recovery checklist
- Verify the fix through tool-confirmed evidence

## 14. Changes to This Policy

This policy may be updated as the project evolves, especially when new Actions, exchange connectors, monitoring tools, deployment tools, or compliance requirements are added.

Updates should preserve the core rules:

- No exposed secrets
- No fabricated results
- No live execution during paper-mode testing
- Verified evidence before claims
- Secure exchange integration only through approved backend systems

## 15. Contact

For questions about this CryptoOps Agent policy, contact the project owner or administrator responsible for the crypto-signal-bot deployment.
