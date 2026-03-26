# CONFIG_ENV_VARS Documentation

This document outlines the required and optional environment variables for configuring the crypto signal bot for both paper and live trading modes.

## Required Environment Variables

| Variable Name          | Purpose                               | Valid Values     | Default           | Example                     |
|------------------------|---------------------------------------|------------------|-------------------|-----------------------------|
| `API_KEY`             | Your API key for market access       | alphanumeric      | None              | `API_KEY=your_api_key`     |
| `API_SECRET`          | Your API secret for secure access    | alphanumeric      | None              | `API_SECRET=your_api_secret`|
| `TRADING_MODE`        | Mode of trading                       | `paper`, `live`   | `paper`           | `TRADING_MODE=live`        |

## Optional Environment Variables

| Variable Name          | Purpose                               | Valid Values               | Default           | Example                             |
|------------------------|---------------------------------------|----------------------------|-------------------|-------------------------------------|
| `LOG_LEVEL`           | Level of logging                      | `debug`, `info`, `warn`, `error` | `info`           | `LOG_LEVEL=debug`                  |
| `PAPER_TRADE_AMOUNT`  | Amount to trade in paper mode        | Numeric                    | `100`             | `PAPER_TRADE_AMOUNT=200`          |
| `LIVE_TRADE_AMOUNT`   | Amount to trade in live mode         | Numeric                    | `0`              | `LIVE_TRADE_AMOUNT=300`           |
| `STRATEGY`            | Trading strategy to employ            | `strategy1`, `strategy2` | `strategy1`      | `STRATEGY=strategy2`              |

## Paper Trading Mode

- Set the `TRADING_MODE` to `paper`.
- Example:
  ```bash
  export API_KEY=your_api_key
  export API_SECRET=your_api_secret
  export TRADING_MODE=paper
  export PAPER_TRADE_AMOUNT=100
  ```

## Live Trading Mode

- Set the `TRADING_MODE` to `live`.
- Example:
  ```bash
  export API_KEY=your_api_key
  export API_SECRET=your_api_secret
  export TRADING_MODE=live
  export LIVE_TRADE_AMOUNT=300
  ```

Make sure to set all required variables appropriately and adjust optional variables according to your trading preferences.