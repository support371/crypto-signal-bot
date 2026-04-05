"""
Startup validation for the Crypto Signal Bot backend.

Runs once at application startup to:
  - Log the active trading mode and adapter
  - Enforce safety gates for mainnet mode
  - Warn about missing or insecure configuration
  - Confirm required directories exist

Raises RuntimeError only for conditions that would cause silent data loss
(e.g. mainnet mode without explicit ALLOW_MAINNET confirmation). All other
issues are logged as warnings so the app still starts in paper mode.
"""

import logging
import os

logger = logging.getLogger("backend.startup")


def run(*, trading_mode: str, network: str, adapter_mode: str) -> None:
    """
    Validate environment and log startup summary.

    Parameters
    ----------
    trading_mode : str
        Value of TRADING_MODE env var ('paper' or 'live').
    network : str
        Value of NETWORK env var ('testnet' or 'mainnet').
    adapter_mode : str
        Resolved adapter label from exchange_adapter.build_adapter()
        ('paper', 'testnet', or 'mainnet').
    """
    _log_banner(trading_mode, network, adapter_mode)
    _check_mainnet_gate(trading_mode, network, adapter_mode)
    _check_credentials(trading_mode, adapter_mode)
    _check_api_key()
    _check_data_dirs()
    _check_ccxt_installed(trading_mode)
    logger.info("Startup checks complete — adapter active: %s", adapter_mode)


# ---------------------------------------------------------------------------
# Internal checks
# ---------------------------------------------------------------------------

def _log_banner(trading_mode: str, network: str, adapter_mode: str) -> None:
    sep = "=" * 60
    logger.info(sep)
    logger.info("  Crypto Signal Bot — Backend starting")
    logger.info("  TRADING_MODE : %s", trading_mode)
    logger.info("  NETWORK      : %s", network)
    logger.info("  ADAPTER      : %s", adapter_mode)
    logger.info("  AUTH         : %s", "enabled" if os.getenv("BACKEND_API_KEY") else "open (dev mode)")
    logger.info(sep)

    if adapter_mode == "mainnet":
        logger.warning("!" * 60)
        logger.warning("  ⚠  MAINNET MODE ACTIVE — REAL FUNDS AT RISK  ⚠")
        logger.warning("!" * 60)
    elif adapter_mode == "testnet":
        logger.info("  Testnet mode — Binance Spot Testnet, no real funds")
    else:
        logger.info("  Paper mode — fully simulated, no exchange connection")


def _check_mainnet_gate(trading_mode: str, network: str, adapter_mode: str) -> None:
    """
    Hard gate: mainnet live trading requires an explicit opt-in env flag
    (ALLOW_MAINNET=true) in addition to TRADING_MODE=live + NETWORK=mainnet.
    This prevents accidental mainnet activation from a stale .env file.
    """
    if trading_mode == "live" and network == "mainnet":
        allow = os.getenv("ALLOW_MAINNET", "").lower()
        if allow != "true":
            # build_adapter() already fell back to paper if ccxt/creds are missing,
            # but if adapter_mode is still 'mainnet' we must enforce the gate.
            if adapter_mode == "mainnet":
                raise RuntimeError(
                    "MAINNET BLOCKED: set ALLOW_MAINNET=true to explicitly enable "
                    "live mainnet trading. This gate prevents accidental real-money exposure."
                )
            # adapter fell back to paper — warn but allow
            logger.warning(
                "TRADING_MODE=live + NETWORK=mainnet requested but adapter fell back "
                "to paper (missing credentials or ccxt). Set ALLOW_MAINNET=true once "
                "you have verified testnet operation."
            )


def _check_credentials(trading_mode: str, adapter_mode: str) -> None:
    """Warn when live mode is requested but credentials are absent."""
    if trading_mode != "live":
        return
    key = os.getenv("BINANCE_API_KEY", "")
    secret = os.getenv("BINANCE_API_SECRET", "")
    if not key or not secret:
        logger.warning(
            "TRADING_MODE=live but BINANCE_API_KEY / BINANCE_API_SECRET are not set. "
            "Adapter fell back to paper mode. Set credentials to enable live execution."
        )
    elif adapter_mode == "paper":
        logger.warning(
            "TRADING_MODE=live with credentials set but adapter is paper — "
            "ccxt may not be installed. Run: pip install ccxt"
        )


def _check_api_key() -> None:
    """Warn when POST endpoints are unauthenticated (no BACKEND_API_KEY)."""
    if not os.getenv("BACKEND_API_KEY"):
        logger.warning(
            "BACKEND_API_KEY is not set — POST endpoints (intents, kill-switch, "
            "withdraw, earnings/reset) are open. Set BACKEND_API_KEY for production."
        )


def _check_data_dirs() -> None:
    """Ensure persistence directories exist."""
    for path_env, default in (
        ("AUDIT_STORE_PATH", "backend/data/audit.json"),
        ("EARNINGS_STORE_PATH", "backend/data/earnings.json"),
    ):
        path = os.getenv(path_env, default)
        directory = os.path.dirname(path) or "."
        os.makedirs(directory, exist_ok=True)


def _check_ccxt_installed(trading_mode: str) -> None:
    """Inform user about ccxt status."""
    if trading_mode != "live":
        return
    try:
        import ccxt  # noqa: F401
        logger.info("ccxt is installed — live exchange adapter available")
    except ImportError:
        logger.warning(
            "ccxt is not installed. Live exchange adapter unavailable. "
            "Install with: pip install ccxt"
        )
