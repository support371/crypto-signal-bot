# backend/services/mt5_bridge/service.py
"""
MT5 bridge service.

Responsibilities:
  - Startup connect with retry
  - Background reconnect loop on connection loss
  - Symbol validation on connect
  - Health reporting hook (consumed by venue_registry)
  - Session refresh (re-login on session expiry)

No trading strategy logic here.
No DB writes here — health state is published to Redis for WebSocket and routes.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from backend.adapters.brokers.base import BrokerHealth
from backend.adapters.brokers.exceptions import (
    BrokerAuthError,
    BrokerConnectionError,
    BrokerUnavailableError,
)

log = logging.getLogger(__name__)

_VENUE = "mt5"
_DEFAULT_RECONNECT_INTERVAL = 5   # seconds
_DEFAULT_MAX_RETRIES        = 10  # attempts before giving up on startup


class MT5BridgeService:
    """
    Manages the lifecycle of the MT5 adapter instance.
    Holds the single shared adapter reference used by the engine.
    """

    def __init__(
        self,
        adapter,                          # MT5BrokerAdapter instance
        reconnect_interval_s: int = _DEFAULT_RECONNECT_INTERVAL,
        max_startup_retries:  int = _DEFAULT_MAX_RETRIES,
    ) -> None:
        self._adapter             = adapter
        self._reconnect_interval  = reconnect_interval_s
        self._max_startup_retries = max_startup_retries
        self._running             = False
        self._reconnect_task: Optional[asyncio.Task] = None
        self._connected           = False
        self._startup_failure:    Optional[str] = None
        self._reconnect_count     = 0

    @property
    def adapter(self):
        return self._adapter

    @property
    def is_connected(self) -> bool:
        return self._connected

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """
        Connect to MT5 terminal with retry.
        After successful connect, start background reconnect monitor.
        Raises on startup failure after max retries.
        """
        self._running = True
        log.info("[MT5Bridge] Starting. Max retries=%d", self._max_startup_retries)

        for attempt in range(1, self._max_startup_retries + 1):
            try:
                await self._adapter.connect()
                self._connected       = True
                self._startup_failure = None
                log.info("[MT5Bridge] Connected on attempt %d.", attempt)
                break
            except BrokerAuthError as exc:
                # Auth failures are fatal — do not retry
                self._startup_failure = str(exc)
                self._connected       = False
                log.error("[MT5Bridge] Auth failure (fatal): %s", exc)
                raise
            except (BrokerConnectionError, BrokerUnavailableError) as exc:
                self._startup_failure = str(exc)
                self._connected       = False
                log.warning(
                    "[MT5Bridge] Connect attempt %d/%d failed: %s — retrying in %ds",
                    attempt, self._max_startup_retries, exc, self._reconnect_interval,
                )
                if attempt < self._max_startup_retries:
                    await asyncio.sleep(self._reconnect_interval)
        else:
            raise BrokerConnectionError(
                f"MT5 failed to connect after {self._max_startup_retries} attempts: "
                f"{self._startup_failure}",
                venue=_VENUE,
            )

        # Start reconnect monitor
        self._reconnect_task = asyncio.create_task(self._reconnect_loop())

    async def stop(self) -> None:
        """Graceful shutdown."""
        self._running = False
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
        await self._adapter.disconnect()
        self._connected = False
        log.info("[MT5Bridge] Stopped.")

    # ------------------------------------------------------------------
    # Reconnect loop
    # ------------------------------------------------------------------

    async def _reconnect_loop(self) -> None:
        """
        Background task: poll health and reconnect when session is lost.
        Publishes health changes to Redis for WebSocket broadcaster.
        """
        log.info("[MT5Bridge] Reconnect monitor started.")
        while self._running:
            await asyncio.sleep(self._reconnect_interval)
            if not self._running:
                break

            health = await self._adapter.health()

            if not health.broker_session_ok or not health.terminal_connected:
                self._connected = False
                log.warning("[MT5Bridge] Session lost — attempting reconnect.")
                await self._publish_health(health)

                try:
                    await self._adapter.connect()
                    self._connected       = True
                    self._reconnect_count += 1
                    log.info(
                        "[MT5Bridge] Reconnected (total reconnects: %d).",
                        self._reconnect_count
                    )
                    # Publish restored health
                    await self._publish_health(await self._adapter.health())
                except Exception as exc:
                    log.warning("[MT5Bridge] Reconnect failed: %s", exc)
            else:
                self._connected = True

        log.info("[MT5Bridge] Reconnect monitor stopped.")

    async def _publish_health(self, health: BrokerHealth) -> None:
        """Publish health state to Redis for WebSocket and routes."""
        try:
            import json
            import aioredis  # type: ignore
            from backend.config.loader import get_redis_config
            cfg = get_redis_config()
            r = await aioredis.from_url(cfg.url, decode_responses=True)
            await r.set(
                "broker:mt5:health",
                json.dumps({
                    "venue":              health.venue,
                    "terminal_connected": health.terminal_connected,
                    "broker_session_ok":  health.broker_session_ok,
                    "symbols_loaded":     health.symbols_loaded,
                    "order_path_ok":      health.order_path_ok,
                    "latency_ms":         health.latency_ms,
                    "last_error":         health.last_error,
                    "timestamp":          health.timestamp,
                }),
                ex=60,
            )
            await r.publish("broker_updates", json.dumps({
                "type":  "broker_health",
                "venue": _VENUE,
                "ok":    health.terminal_connected and health.broker_session_ok,
                "ts":    health.timestamp,
            }))
        except Exception as exc:
            log.debug("[MT5Bridge] Health publish failed (non-fatal): %s", exc)

    # ------------------------------------------------------------------
    # Public health
    # ------------------------------------------------------------------

    async def get_health(self) -> BrokerHealth:
        """Return current bridge + adapter health."""
        return await self._adapter.health()

    def get_reconnect_count(self) -> int:
        return self._reconnect_count
