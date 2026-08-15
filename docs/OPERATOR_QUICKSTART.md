# Operator Quick Start

This release is a paper-trading and certification system. It is not authorized to place live orders, use mainnet funds, or withdraw assets.

## Open the service

1. Open `https://crypto-signal-bot-indol.vercel.app/dashboard`.
2. Confirm the header says **Certification** or **Paper**.
3. Open **Infrastructure** and confirm trading mode is `paper`, network is `testnet`, and live trading and withdrawals are disabled.
4. If any safety status is missing, stop the session and run `npm run verify:deployment` from a trusted checkout.

## Run a first certification session

1. Start with the default certification portfolio. Do not connect a funded exchange account.
2. Choose one liquid market, such as BTC/USDT, and observe its price, signal direction, confidence, regime, and risk decision.
3. Rehearse an order only when the risk panel approves it. The dashboard sends this to `/intent/paper`; it does not send an exchange order.
4. Record the entry reason, signal confidence, risk score, simulated size, and expected invalidation point.
5. Review the paper portfolio, audit trail, and realized certification P&L after the position closes.
6. Use **Backtest** to compare the same strategy over historical data. Treat results as research evidence, not a prediction.

## Minimum evaluation before considering any separate real-money activity

- Complete at least 30 calendar days and 100 paper trades.
- Evaluate maximum drawdown, win rate, expectancy after fees, and results by market regime.
- Reject a strategy if profitability depends on one or two outlier trades.
- Do not use borrowed money, rent money, emergency savings, or credit-card funds.
- Decide any real investment outside this application and start with an amount you can afford to lose completely.

The application must remain paper-only until a separately reviewed, audited, and explicitly authorized release exists. The current Worker deliberately returns HTTP 403 for live order and withdrawal routes.

## Owner-only remaining operations

- Maintain Cloudflare and Vercel deployment credentials.
- Trigger the manual production release workflow.
- Review Cloudflare/Vercel billing and access controls.
- Decide whether to configure authenticated operator access.
- Decide whether the project should ever pursue a separately audited live release.
