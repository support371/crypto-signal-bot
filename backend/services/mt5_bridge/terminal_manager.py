# backend/services/mt5_bridge/terminal_manager.py
"""
MT5 terminal manager.

Encapsulates the local MetaTrader 5 terminal lifecycle:
  - config validation at startup
  - terminal initialization
  - login session management
  - explicit disconnect
  - last error tracking

Separates the concerns of adapter normalization (mt5.py)
from terminal process management.

Rules:
  - Fail explicitly when path or login credentials are invalid
  - No trading strategy logic
  - No DB writes
  - All errors re-raised as typed BrokerError subclasses
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

from backend.adapters.brokers.exceptions import (
    BrokerAuthError,
    BrokerConnectionError,
    BrokerUnavailableError,
)

log = logging.getLogger(__name__)


@dataclass
class TerminalState:
    initialized:         bool = False
    logged_in:           bool = False
    login_id:            Optional[int]  = None
    server:              Optional[str]  = None
    last_error_code:     Optional[int]  = None
    last_error_message:  Optional[str]  = None
    last_seen_at:        Optional[int]  = None
    connect_count:       int = 0
    disconnect_count:    int = 0


class MT5TerminalManager:
    """
    Manages the MT5 terminal process connection.

    Config sources (in priority order):
      1. Constructor kwargs
      2. Environment variables (MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, MT5_TERMINAL_PATH)
      3. Raises ConfigurationError if required fields absent

    Terminal requirements:
      - MetaTrader 5 terminal must be running on the same machine
      - Windows required (or Wine on Linux)
      - MetaTrader5 Python library must be installed
    """

    REQUIRED_ENV_VARS = ["MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"]

    def __init__(
        self,
        login:        Optional[int]  = None,
        password:     Optional[str]  = None,
        server:       Optional[str]  = None,
        path:         Optional[str]  = None,
        timeout_ms:   int = 10_000,
    ) -> None:
        # Resolve from constructor or environment
        self._login    = login    or self._env_int("MT5_LOGIN")
        self._password = password or self._env_str("MT5_PASSWORD")
        self._server   = server   or self._env_str("MT5_SERVER")
        self._path     = path     or os.environ.get("MT5_TERMINAL_PATH")
        self._timeout  = timeout_ms
        self._state    = TerminalState()
        self._mt5      = None

    # ------------------------------------------------------------------
    # Config validation
    # ------------------------------------------------------------------

    @staticmethod
    def _env_int(key: str) -> Optional[int]:
        val = os.environ.get(key)
        if val:
            try:
                return int(val)
            except ValueError:
                raise BrokerConnectionError(
                    f"Environment variable {key!r} must be an integer, got: {val!r}",
                    venue="mt5",
                )
        return None

    @staticmethod
    def _env_str(key: str) -> Optional[str]:
        return os.environ.get(key)

    def validate_config(self) -> None:
        """
        Validate that all required configuration is present.
        Raises BrokerConnectionError with explicit message on missing fields.
        """
        missing = []
        if not self._login:
            missing.append("MT5_LOGIN (int account number)")
        if not self._password:
            missing.append("MT5_PASSWORD")
        if not self._server:
            missing.append("MT5_SERVER (broker server name)")

        if missing:
            raise BrokerConnectionError(
                f"MT5 configuration incomplete. Missing: {', '.join(missing)}. "
                f"Set environment variables or pass to MT5TerminalManager constructor.",
                venue="mt5",
            )

        if self._path and not os.path.exists(self._path):
            raise BrokerConnectionError(
                f"MT5_TERMINAL_PATH does not exist: {self._path!r}",
                venue="mt5",
            )

        log.info("[MT5TerminalManager] Config validated: login=%s server=%s",
                 self._login, self._server)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def _get_mt5(self):
        if self._mt5 is not None:
            return self._mt5
        try:
            import MetaTrader5 as mt5
            self._mt5 = mt5
            return mt5
        except ImportError:
            raise BrokerUnavailableError(
                "MetaTrader5 Python library not installed. "
                "Run: pip install MetaTrader5 "
                "(Windows or Wine required)",
                venue="mt5",
            )

    def _record_error(self) -> None:
        try:
            mt5 = self._get_mt5()
            code, msg = mt5.last_error()
            self._state.last_error_code    = code
            self._state.last_error_message = msg
        except Exception:
            pass

    async def initialize(self) -> None:
        """Initialize the terminal process. Raises on failure."""
        self.validate_config()
        mt5 = self._get_mt5()

        kwargs: dict = {"timeout": self._timeout}
        if self._path:
            kwargs["path"] = self._path

        ok = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.initialize(**kwargs)
        )
        if not ok:
            self._record_error()
            raise BrokerConnectionError(
                f"MT5 terminal initialization failed: "
                f"{self._state.last_error_code} — {self._state.last_error_message}",
                venue="mt5",
            )

        self._state.initialized  = True
        self._state.last_seen_at = int(time.time())
        log.info("[MT5TerminalManager] Terminal initialized.")

    async def login(self) -> None:
        """
        Attempt broker login.
        Raises BrokerAuthError on credential failure.
        """
        if not self._state.initialized:
            await self.initialize()

        mt5 = self._get_mt5()
        ok = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.login(self._login, self._password, self._server)
        )
        if not ok:
            self._record_error()
            raise BrokerAuthError(
                f"MT5 login failed for login={self._login} server={self._server}: "
                f"{self._state.last_error_code} — {self._state.last_error_message}",
                venue="mt5",
            )

        self._state.logged_in   = True
        self._state.login_id    = self._login
        self._state.server      = self._server
        self._state.connect_count += 1
        self._state.last_seen_at  = int(time.time())
        log.info("[MT5TerminalManager] Logged in: login=%d server=%s", self._login, self._server)

    async def disconnect(self) -> None:
        """Shutdown the terminal. Best-effort — never raises."""
        try:
            mt5 = self._get_mt5()
            await asyncio.get_event_loop().run_in_executor(None, mt5.shutdown)
        except Exception as exc:
            log.debug("[MT5TerminalManager] Disconnect error (ignored): %s", exc)
        finally:
            self._state.initialized        = False
            self._state.logged_in          = False
            self._state.disconnect_count   += 1
            log.info("[MT5TerminalManager] Terminal shutdown.")

    # ------------------------------------------------------------------
    # State accessors
    # ------------------------------------------------------------------

    @property
    def is_initialized(self) -> bool:
        return self._state.initialized

    @property
    def is_logged_in(self) -> bool:
        return self._state.logged_in

    @property
    def state(self) -> TerminalState:
        return self._state

    @property
    def login_id(self) -> Optional[int]:
        return self._login

    @property
    def server(self) -> Optional[str]:
        return self._server
