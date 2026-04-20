# backend/adapters/brokers/mt5.py
"""
MT5BrokerAdapter — MetaTrader 5 broker adapter.

Implements BrokerAdapter using the MetaTrader5 Python library.
The MT5 library communicates with the local MetaTrader 5 terminal process.

IMPORTANT RUNTIME REQUIREMENT:
  - MetaTrader5 terminal must be running on the SAME machine as the backend.
  - The library is Windows-only (also runs on Wine).
  - VPS or local Windows machine required.
  - This adapter will not function in a Vercel or pure cloud environment.

Rules:
  - All MT5 responses are normalized before leaving this file
  - No route logic here
  - No DB writes here
  - MT5 credential read from config (never from frontend)
  - BrokerError subclasses raised on all failures

Protected files: none accessed here.
"""

from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal
from functools import wraps
from typing import Optional

from backend.adapters.brokers.base import (
    BrokerAdapter,
    BrokerAccountInfo,
    BrokerFill,
    BrokerHealth,
    BrokerOrder,
    BrokerPosition,
    BrokerQuote,
    BrokerSymbol,
)
from backend.adapters.brokers.exceptions import (
    BrokerAuthError,
    BrokerConnectionError,
    BrokerOrderError,
    BrokerPositionError,
    BrokerSymbolError,
    BrokerUnavailableError,
)
from backend.adapters.brokers.symbol_mapper import SymbolMapper

log = logging.getLogger(__name__)

# MT5 order types
_MT5_ORDER_TYPE_BUY  = 0
_MT5_ORDER_TYPE_SELL = 1
_MT5_ORDER_MARKET    = 0   # ORDER_TYPE_BUY (market)
_MT5_POSITION_LONG   = 0
_MT5_POSITION_SHORT  = 1

# MT5 trade actions
_TRADE_ACTION_DEAL   = 1   # market order
_TRADE_ACTION_PENDING = 5
_TRADE_ACTION_SLTP   = 6   # modify SL/TP
_TRADE_ACTION_CLOSE_BY = 10

# Return code
_TRADE_RETCODE_DONE  = 10009


def _try_import_mt5():
    """
    Lazy import of MetaTrader5 library.
    Returns the module or None if not installed/available.
    """
    try:
        import MetaTrader5 as mt5
        return mt5
    except ImportError:
        return None


class MT5BrokerAdapter(BrokerAdapter):
    """
    MetaTrader 5 broker adapter.

    Configuration (from backend.config.settings via MT5BridgeConfig):
        MT5_LOGIN       — account login ID
        MT5_PASSWORD    — account password
        MT5_SERVER      — broker server name
        MT5_PATH        — path to terminal64.exe (optional if already in PATH)
        MT5_TIMEOUT_MS  — connection timeout in milliseconds (default: 10000)
    """

    venue_name = "mt5"

    def __init__(
        self,
        login:       int,
        password:    str,
        server:      str,
        path:        Optional[str] = None,
        timeout_ms:  int = 10_000,
        magic_number: int = 900_001,
        order_comment_prefix: str = "CRA",
        symbol_mapper: Optional[SymbolMapper] = None,
    ) -> None:
        self.login              = login
        self.password           = password
        self.server             = server
        self.path               = path
        self.timeout_ms         = timeout_ms
        self.magic_number       = magic_number
        self.order_comment_prefix = order_comment_prefix
        self._mapper            = symbol_mapper or SymbolMapper()
        self._connected         = False
        self._authorized        = False
        self._symbols_loaded    = False
        self._last_error: Optional[str] = None
        self._latency_ms: Optional[float] = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _mt5(self):
        mt5 = _try_import_mt5()
        if mt5 is None:
            raise BrokerUnavailableError(
                "MetaTrader5 Python library is not installed. "
                "Run: pip install MetaTrader5",
                venue=self.venue_name,
            )
        return mt5

    def _assert_connected(self) -> None:
        if not self._connected or not self._authorized:
            raise BrokerConnectionError(
                "MT5 terminal is not connected. Call connect() first.",
                venue=self.venue_name,
            )

    def _mt5_error(self) -> str:
        try:
            mt5 = self._mt5()
            code, desc = mt5.last_error()
            return f"MT5 error {code}: {desc}"
        except Exception:
            return "MT5 error (unknown)"

    def _side_from_type(self, order_type: int) -> str:
        return "BUY" if order_type == _MT5_ORDER_TYPE_BUY else "SELL"

    def _side_from_position(self, position_type: int) -> str:
        return "LONG" if position_type == _MT5_POSITION_LONG else "SHORT"

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """
        Initialize MT5 terminal and login.
        Must be called before any trading operations.
        Raises BrokerConnectionError or BrokerAuthError on failure.
        """
        mt5 = self._mt5()
        t0 = time.time()

        # Initialize terminal
        kwargs = {"timeout": self.timeout_ms}
        if self.path:
            kwargs["path"] = self.path

        initialized = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.initialize(**kwargs)
        )
        if not initialized:
            err = self._mt5_error()
            self._last_error = err
            raise BrokerConnectionError(f"Terminal initialization failed: {err}", venue=self.venue_name)

        self._connected = True
        log.info("[MT5] Terminal initialized.")

        # Login
        logged_in = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: mt5.login(self.login, self.password, self.server)
        )
        if not logged_in:
            err = self._mt5_error()
            self._last_error = err
            mt5.shutdown()
            self._connected = False
            raise BrokerAuthError(f"Login failed: {err}", venue=self.venue_name)

        self._authorized = True
        self._latency_ms = (time.time() - t0) * 1000
        log.info("[MT5] Logged in: login=%d server=%s latency=%.0fms",
                 self.login, self.server, self._latency_ms)

        # Load symbols into mapper
        await self._load_symbols()

    async def disconnect(self) -> None:
        """Clean shutdown. Best-effort."""
        try:
            mt5 = _try_import_mt5()
            if mt5:
                await asyncio.get_event_loop().run_in_executor(None, mt5.shutdown)
        except Exception as exc:
            log.warning("[MT5] Disconnect error (ignored): %s", exc)
        finally:
            self._connected  = False
            self._authorized = False
            self._symbols_loaded = False
            log.info("[MT5] Disconnected.")

    async def _load_symbols(self) -> None:
        mt5 = self._mt5()
        raw = await asyncio.get_event_loop().run_in_executor(
            None, mt5.symbols_get
        )
        if raw:
            broker_symbols = [s.name for s in raw]
            self._mapper.register_broker_symbols(broker_symbols)
            self._symbols_loaded = True
            log.info("[MT5] Loaded %d symbols.", len(broker_symbols))

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health(self) -> BrokerHealth:
        """Never raises — returns error state on failure."""
        order_path_ok = False
        try:
            if self._connected and self._authorized:
                # Quick ping via account_info
                mt5 = self._mt5()
                info = await asyncio.get_event_loop().run_in_executor(
                    None, mt5.account_info
                )
                order_path_ok = info is not None
        except Exception as exc:
            self._last_error = str(exc)

        return BrokerHealth(
            venue=self.venue_name,
            terminal_connected=self._connected,
            broker_session_ok=self._authorized,
            symbols_loaded=self._symbols_loaded,
            order_path_ok=order_path_ok,
            latency_ms=self._latency_ms,
            last_error=self._last_error,
            timestamp=int(time.time()),
        )

    # ------------------------------------------------------------------
    # Account
    # ------------------------------------------------------------------

    async def account_info(self) -> BrokerAccountInfo:
        self._assert_connected()
        mt5 = self._mt5()
        info = await asyncio.get_event_loop().run_in_executor(None, mt5.account_info)
        if info is None:
            raise BrokerUnavailableError(self._mt5_error(), venue=self.venue_name)
        return BrokerAccountInfo(
            venue=self.venue_name,
            login_id=str(info.login),
            server=info.server,
            equity=Decimal(str(info.equity)),
            balance=Decimal(str(info.balance)),
            margin=Decimal(str(info.margin)),
            free_margin=Decimal(str(info.margin_free)),
            margin_level=float(info.margin_level),
            currency=info.currency,
            leverage=int(info.leverage),
            timestamp=int(time.time()),
        )

    async def symbols(self) -> list[BrokerSymbol]:
        self._assert_connected()
        mt5 = self._mt5()
        raw = await asyncio.get_event_loop().run_in_executor(None, mt5.symbols_get)
        if raw is None:
            return []
        result = []
        for s in raw:
            internal = self._mapper.to_internal(s.name)
            if internal is None:
                continue
            result.append(BrokerSymbol(
                venue=self.venue_name,
                broker_symbol=s.name,
                internal_symbol=internal,
                base_asset=s.currency_base,
                quote_asset=s.currency_profit,
                trade_mode=s.trade_mode,
                visible=bool(s.visible),
                contract_size=float(s.trade_contract_size),
                volume_min=float(s.volume_min),
                volume_step=float(s.volume_step),
                point=float(s.point),
                digits=int(s.digits),
            ))
        return result

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    async def quote(self, symbol: str) -> BrokerQuote:
        self._assert_connected()
        broker_sym = self._mapper.to_broker(symbol)
        if broker_sym is None:
            raise BrokerSymbolError(
                f"No broker mapping for symbol: {symbol}", venue=self.venue_name
            )
        mt5 = self._mt5()
        tick = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.symbol_info_tick(broker_sym)
        )
        if tick is None:
            raise BrokerSymbolError(
                f"No tick data for {broker_sym}: {self._mt5_error()}",
                venue=self.venue_name,
            )
        bid = Decimal(str(tick.bid))
        ask = Decimal(str(tick.ask))
        return BrokerQuote(
            venue=self.venue_name,
            symbol=symbol,
            broker_symbol=broker_sym,
            bid=bid,
            ask=ask,
            spread=ask - bid,
            timestamp=int(time.time()),
        )

    # ------------------------------------------------------------------
    # Positions
    # ------------------------------------------------------------------

    async def positions(self) -> list[BrokerPosition]:
        self._assert_connected()
        mt5 = self._mt5()
        raw = await asyncio.get_event_loop().run_in_executor(
            None, mt5.positions_get
        )
        if raw is None:
            return []
        result = []
        for p in raw:
            internal = self._mapper.to_internal(p.symbol)
            result.append(BrokerPosition(
                venue=self.venue_name,
                position_id=str(p.ticket),
                symbol=internal or p.symbol,
                broker_symbol=p.symbol,
                side=self._side_from_position(p.type),
                volume=Decimal(str(p.volume)),
                entry_price=Decimal(str(p.price_open)),
                current_price=Decimal(str(p.price_current)),
                sl=Decimal(str(p.sl)) if p.sl else None,
                tp=Decimal(str(p.tp)) if p.tp else None,
                unrealized_pnl=Decimal(str(p.profit)),
                swap=Decimal(str(p.swap)),
                comment=p.comment or "",
                magic_number=int(p.magic),
                opened_at=int(p.time),
                updated_at=int(time.time()),
            ))
        return result

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------

    async def orders(self, limit: int = 100) -> list[BrokerOrder]:
        self._assert_connected()
        mt5 = self._mt5()
        raw = await asyncio.get_event_loop().run_in_executor(
            None, mt5.orders_get
        )
        if raw is None:
            return []
        result = []
        for o in raw[:limit]:
            internal = self._mapper.to_internal(o.symbol)
            result.append(BrokerOrder(
                venue=self.venue_name,
                client_order_id=str(o.ticket),
                broker_order_id=str(o.ticket),
                symbol=internal or o.symbol,
                broker_symbol=o.symbol,
                side=self._side_from_type(o.type),
                order_type="LIMIT" if o.type in (2, 3) else "MARKET",
                volume=Decimal(str(o.volume_initial)),
                requested_price=Decimal(str(o.price_open)) if o.price_open else None,
                fill_price=Decimal(str(o.price_current)) if o.price_current else None,
                sl=Decimal(str(o.sl)) if o.sl else None,
                tp=Decimal(str(o.tp)) if o.tp else None,
                status="PENDING",
                comment=o.comment or "",
                magic_number=int(o.magic),
                reason=None,
                created_at=int(o.time_setup),
                updated_at=int(time.time()),
            ))
        return result

    # ------------------------------------------------------------------
    # Order submission
    # ------------------------------------------------------------------

    async def submit_order(
        self,
        internal_symbol: str,
        side:            str,
        order_type:      str,
        volume:          Decimal,
        price:           Optional[Decimal] = None,
        sl:              Optional[Decimal] = None,
        tp:              Optional[Decimal] = None,
        comment:         str = "",
        magic_number:    int = 0,
    ) -> BrokerOrder:
        self._assert_connected()
        broker_sym = self._mapper.to_broker(internal_symbol)
        if broker_sym is None:
            raise BrokerSymbolError(
                f"No broker mapping for: {internal_symbol}", venue=self.venue_name
            )

        mt5 = self._mt5()
        sym_info = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.symbol_info(broker_sym)
        )
        if sym_info is None:
            raise BrokerSymbolError(f"Symbol info unavailable: {broker_sym}", venue=self.venue_name)

        order_type_mt5 = (
            _MT5_ORDER_TYPE_BUY if side.upper() == "BUY" else _MT5_ORDER_TYPE_SELL
        )

        # For market orders, use current price
        if order_type.upper() == "MARKET":
            tick = await asyncio.get_event_loop().run_in_executor(
                None, lambda: mt5.symbol_info_tick(broker_sym)
            )
            if tick is None:
                raise BrokerUnavailableError(
                    f"No tick data for market order: {broker_sym}", venue=self.venue_name
                )
            exec_price = tick.ask if side.upper() == "BUY" else tick.bid
        else:
            exec_price = float(price) if price else 0.0

        comment_full = f"{self.order_comment_prefix}:{comment}" if comment else self.order_comment_prefix
        magic = magic_number or self.magic_number

        request = {
            "action":    _TRADE_ACTION_DEAL,
            "symbol":    broker_sym,
            "volume":    float(volume),
            "type":      order_type_mt5,
            "price":     exec_price,
            "deviation": 20,
            "magic":     magic,
            "comment":   comment_full,
            "type_time": 0,    # ORDER_TIME_GTC
            "type_filling": 2, # ORDER_FILLING_IOC — adjust per broker
        }
        if sl:
            request["sl"] = float(sl)
        if tp:
            request["tp"] = float(tp)

        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.order_send(request)
        )

        if result is None or result.retcode != _TRADE_RETCODE_DONE:
            code = result.retcode if result else None
            comment_resp = result.comment if result else self._mt5_error()
            raise BrokerOrderError(
                f"Order rejected: {comment_resp} (retcode={code})",
                venue=self.venue_name,
                broker_error_code=code,
            )

        now = int(time.time())
        return BrokerOrder(
            venue=self.venue_name,
            client_order_id=str(result.order),
            broker_order_id=str(result.order),
            symbol=internal_symbol,
            broker_symbol=broker_sym,
            side=side.upper(),
            order_type=order_type.upper(),
            volume=volume,
            requested_price=price,
            fill_price=Decimal(str(result.price)) if result.price else None,
            sl=sl, tp=tp,
            status="FILLED" if result.retcode == _TRADE_RETCODE_DONE else "PENDING",
            comment=comment_full,
            magic_number=magic,
            reason=None,
            created_at=now,
            updated_at=now,
        )

    # ------------------------------------------------------------------
    # Position management
    # ------------------------------------------------------------------

    async def modify_position(
        self,
        position_id: str,
        sl: Optional[Decimal] = None,
        tp: Optional[Decimal] = None,
    ) -> BrokerPosition:
        self._assert_connected()
        mt5 = self._mt5()

        # Fetch existing position
        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.positions_get(ticket=int(position_id))
        )
        if not raw:
            raise BrokerPositionError(
                f"Position {position_id} not found", venue=self.venue_name
            )
        pos = raw[0]

        request = {
            "action":      _TRADE_ACTION_SLTP,
            "position":    int(position_id),
            "symbol":      pos.symbol,
            "sl":          float(sl) if sl is not None else pos.sl,
            "tp":          float(tp) if tp is not None else pos.tp,
        }
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.order_send(request)
        )
        if result is None or result.retcode != _TRADE_RETCODE_DONE:
            code = result.retcode if result else None
            raise BrokerPositionError(
                f"Modify failed: retcode={code}", venue=self.venue_name
            )

        # Refresh
        updated = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.positions_get(ticket=int(position_id))
        )
        p = updated[0] if updated else pos
        internal = self._mapper.to_internal(p.symbol)
        return BrokerPosition(
            venue=self.venue_name,
            position_id=str(p.ticket),
            symbol=internal or p.symbol,
            broker_symbol=p.symbol,
            side=self._side_from_position(p.type),
            volume=Decimal(str(p.volume)),
            entry_price=Decimal(str(p.price_open)),
            current_price=Decimal(str(p.price_current)),
            sl=Decimal(str(p.sl)) if p.sl else None,
            tp=Decimal(str(p.tp)) if p.tp else None,
            unrealized_pnl=Decimal(str(p.profit)),
            swap=Decimal(str(p.swap)),
            comment=p.comment or "",
            magic_number=int(p.magic),
            opened_at=int(p.time),
            updated_at=int(time.time()),
        )

    async def close_position(
        self,
        position_id: str,
        volume: Optional[Decimal] = None,
    ) -> BrokerFill:
        self._assert_connected()
        mt5 = self._mt5()

        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.positions_get(ticket=int(position_id))
        )
        if not raw:
            raise BrokerPositionError(f"Position {position_id} not found", venue=self.venue_name)

        pos  = raw[0]
        vol  = float(volume) if volume else pos.volume
        side = _MT5_ORDER_TYPE_SELL if pos.type == _MT5_POSITION_LONG else _MT5_ORDER_TYPE_BUY

        tick = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.symbol_info_tick(pos.symbol)
        )
        price = tick.bid if side == _MT5_ORDER_TYPE_SELL else tick.ask

        request = {
            "action":    _TRADE_ACTION_DEAL,
            "position":  int(position_id),
            "symbol":    pos.symbol,
            "volume":    vol,
            "type":      side,
            "price":     price,
            "deviation": 20,
            "magic":     int(pos.magic),
            "comment":   f"{self.order_comment_prefix}:close",
            "type_time": 0,
            "type_filling": 2,
        }

        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.order_send(request)
        )
        if result is None or result.retcode != _TRADE_RETCODE_DONE:
            code = result.retcode if result else None
            raise BrokerPositionError(f"Close failed: retcode={code}", venue=self.venue_name)

        internal = self._mapper.to_internal(pos.symbol)
        now = int(time.time())
        return BrokerFill(
            venue=self.venue_name,
            fill_id=str(result.deal),
            broker_order_id=str(result.order),
            position_id=position_id,
            symbol=internal or pos.symbol,
            broker_symbol=pos.symbol,
            side="SELL" if pos.type == _MT5_POSITION_LONG else "BUY",
            volume=Decimal(str(vol)),
            price=Decimal(str(result.price)),
            fee=Decimal("0"),
            realized_pnl=Decimal(str(pos.profit)),
            timestamp=now,
        )

    async def cancel_order(self, broker_order_id: str) -> BrokerOrder:
        self._assert_connected()
        mt5 = self._mt5()

        request = {
            "action": 8,  # TRADE_ACTION_REMOVE
            "order":  int(broker_order_id),
        }
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: mt5.order_send(request)
        )
        if result is None or result.retcode != _TRADE_RETCODE_DONE:
            code = result.retcode if result else None
            raise BrokerOrderError(f"Cancel failed: retcode={code}", venue=self.venue_name)

        now = int(time.time())
        return BrokerOrder(
            venue=self.venue_name,
            client_order_id=broker_order_id,
            broker_order_id=broker_order_id,
            symbol="", broker_symbol="",
            side="BUY", order_type="MARKET",
            volume=Decimal("0"), requested_price=None, fill_price=None,
            sl=None, tp=None, status="CANCELLED",
            comment="", magic_number=0, reason="cancelled",
            created_at=now, updated_at=now,
        )

    # ------------------------------------------------------------------
    # Symbol utilities
    # ------------------------------------------------------------------

    def normalize_symbol(self, internal_symbol: str) -> str:
        return self._mapper.to_broker(internal_symbol) or internal_symbol

    def supports_symbol(self, internal_symbol: str) -> bool:
        return self._mapper.to_broker(internal_symbol) is not None
