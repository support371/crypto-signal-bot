# docs/runbooks/mt5_setup.md
# MT5 Integration — Setup Runbook

## Overview

MetaTrader 5 is an optional broker execution venue in the crypto-signal-bot backend.
It is an **adapter only** — the strategy engine, risk engine, guardian, and execution
coordinator are unchanged. MT5 is one of several execution venues that the coordinator
can route orders to.

---

## Runtime Requirements

| Requirement | Notes |
|---|---|
| **MetaTrader 5 Terminal** | Must be running on the SAME machine as the backend |
| **Windows OS** | Or Wine on Linux/macOS — MT5 Python library is Windows-native |
| **Python library** | `pip install MetaTrader5` |
| **Network** | Terminal connects outbound to broker's trading server |

**Vercel is not a supported backend host for MT5.** MT5 requires a persistent process
on an always-on server (VPS, local machine, or a Windows cloud VM).

---

## Required Environment Variables

Set these on the backend server — never in frontend or committed files.

```bash
# Broker account credentials
MT5_LOGIN=12345678               # Your MT5 account number (integer)
MT5_PASSWORD=your_password       # Account password
MT5_SERVER=BrokerName-Server     # Broker's MT5 server name

# Optional
MT5_TERMINAL_PATH=/path/to/terminal64.exe   # Path to MT5 terminal binary
MT5_TIMEOUT_MS=10000             # Connection timeout in ms (default: 10000)
```

Verify the server name in your MT5 terminal: Login dialog → Server field.

---

## Symbol Map Configuration

MT5 uses different symbol names than the internal system.
Default mappings are applied automatically:

| Internal | MT5 (default) |
|---|---|
| BTCUSDT | BTCUSD |
| ETHUSDT | ETHUSD |
| SOLUSDT | SOLUSD |
| BNBUSDT | BNBUSD |
| XRPUSDT | XRPUSD |

To override defaults, set in `config/mt5.yaml` (loaded at startup):

```yaml
mt5:
  symbol_map:
    BTCUSDT: BTCUSD.raw    # broker-specific variant
    ETHUSDT: ETHUSD.pro
```

Verify your broker's symbol names in MT5: MarketWatch panel.

---

## Startup Flow

```
1. Backend starts
2. Config loads MT5 section (enabled: true)
3. MT5TerminalManager.validate_config()
   - Checks MT5_LOGIN, MT5_PASSWORD, MT5_SERVER are set
   - Checks MT5_TERMINAL_PATH exists if provided
   - Fails explicitly if any required field is missing
4. MT5BridgeService.start()
   - MT5BrokerAdapter.connect()
   - Terminal initialized
   - Login attempted (retries up to max_startup_retries)
   - Symbols loaded, mapped, registered
   - venue_registry marks MT5 available
5. MT5 is now a selectable execution venue
6. Health polling begins (background reconnect loop)
```

If startup fails with BrokerAuthError: check login/password/server.
If startup fails with BrokerConnectionError: check terminal is running.

---

## Enabling MT5 in Config

```yaml
# config/mt5.yaml (or environment equivalent)
mt5:
  enabled: true
  mode: live                    # "live" or "paper"
  login_env: MT5_LOGIN
  password_env: MT5_PASSWORD
  server_env: MT5_SERVER
  path_env: MT5_TERMINAL_PATH
  timeout_seconds: 10
  reconnect_interval_seconds: 5
  magic_number: 900001           # Magic number for this bot's orders
  order_comment_prefix: CRA      # Comment prefix for audit trail
  max_order_retries: 2
  symbol_map:
    BTCUSDT: BTCUSD
    ETHUSDT: ETHUSD
```

---

## Verifying MT5 is Live

```bash
# Check venues
curl http://localhost:8000/broker/venues
# → [{"venue_id": "mt5", "venue_type": "broker", "available": true}]

# Check health
curl http://localhost:8000/broker/mt5/health
# → {"terminal_connected": true, "broker_session_ok": true, "order_path_ok": true}

# Check account
curl -H "X-API-Key: your-key" http://localhost:8000/broker/mt5/account
# → {"login_id": "12345678", "equity": 10000.0, ...}

# Check symbols
curl http://localhost:8000/broker/mt5/symbols
# → [{"broker_symbol": "BTCUSD", "internal_symbol": "BTCUSDT", ...}]
```

---

## Known Limitations

- MT5 Python library is Windows-only (Wine required on Linux)
- Only one terminal instance can be connected per machine per account
- MetaTrader 5 terminal must be running before the backend starts
- Sessions expire on broker restart — the bridge service reconnects automatically
- Maximum 5 connections per account on most brokers (check your broker's TOS)
- Order filling modes vary by broker — `type_filling` may need adjustment per broker
- MT5 does not support fractional lots below `volume_min` — validate before routing

---

## Security Notes

- MT5 credentials are backend-only environment variables
- The frontend never receives MT5 login or session information
- `POST /broker/mt5/connect` and `POST /broker/mt5/disconnect` require X-API-Key
- Symbol map and magic number are in server-side config — not exposed to clients
