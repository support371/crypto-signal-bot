"""Tests for the broker normalizer (backend/engine/broker_normalizer.py)."""

from decimal import Decimal

from backend.adapters.brokers.base import (
    BrokerAccountInfo,
    BrokerFill,
    BrokerHealth,
    BrokerOrder,
    BrokerPosition,
)
from backend.engine.broker_normalizer import (
    normalize_order,
    normalize_position,
    normalize_fill,
    normalize_health,
    account_to_dict,
    broker_fill_to_exchange_fill,
)


def _make_order(**overrides):
    defaults = dict(
        venue="mt5", client_order_id="c1", broker_order_id="b1",
        symbol="BTCUSDT", broker_symbol="BTCUSD", side="BUY",
        order_type="MARKET", volume=Decimal("0.1"),
        requested_price=Decimal("50000"), fill_price=Decimal("50010"),
        sl=Decimal("49000"), tp=Decimal("52000"),
        status="FILLED", comment="test", magic_number=100,
        reason=None, created_at=1000, updated_at=1001,
    )
    defaults.update(overrides)
    return BrokerOrder(**defaults)


def _make_position(**overrides):
    defaults = dict(
        venue="mt5", position_id="p1", symbol="BTCUSDT",
        broker_symbol="BTCUSD", side="LONG", volume=Decimal("0.1"),
        entry_price=Decimal("50000"), current_price=Decimal("51000"),
        sl=Decimal("49000"), tp=Decimal("55000"),
        unrealized_pnl=Decimal("100"), swap=Decimal("-2.5"),
        comment="test", magic_number=100,
        opened_at=1000, updated_at=1001,
    )
    defaults.update(overrides)
    return BrokerPosition(**defaults)


def _make_fill(**overrides):
    defaults = dict(
        venue="mt5", fill_id="f1", broker_order_id="b1",
        position_id="p1", symbol="BTCUSDT", broker_symbol="BTCUSD",
        side="BUY", volume=Decimal("0.1"), price=Decimal("50010"),
        fee=Decimal("0.5"), realized_pnl=Decimal("100"),
        timestamp=1000,
    )
    defaults.update(overrides)
    return BrokerFill(**defaults)


def _make_health(**overrides):
    defaults = dict(
        venue="mt5", terminal_connected=True, broker_session_ok=True,
        symbols_loaded=True, order_path_ok=True, latency_ms=5.2,
        last_error=None, timestamp=1000,
    )
    defaults.update(overrides)
    return BrokerHealth(**defaults)


def _make_account(**overrides):
    defaults = dict(
        venue="mt5", login_id="12345", server="Demo-Server",
        equity=Decimal("10000"), balance=Decimal("9500"),
        margin=Decimal("500"), free_margin=Decimal("9000"),
        margin_level=1900.0, currency="USD", leverage=100,
        timestamp=1000,
    )
    defaults.update(overrides)
    return BrokerAccountInfo(**defaults)


class TestNormalizeOrder:
    def test_basic_fields(self):
        rec = normalize_order(_make_order())
        assert rec.venue == "mt5"
        assert rec.symbol == "BTCUSDT"
        assert rec.side == "BUY"
        assert rec.status == "FILLED"

    def test_decimal_to_float(self):
        rec = normalize_order(_make_order())
        assert isinstance(rec.volume, float)
        assert rec.volume == 0.1
        assert rec.fill_price == 50010.0

    def test_none_prices(self):
        rec = normalize_order(_make_order(
            requested_price=None, fill_price=None, sl=None, tp=None
        ))
        assert rec.requested_price is None
        assert rec.fill_price is None
        assert rec.sl is None
        assert rec.tp is None


class TestNormalizePosition:
    def test_basic_fields(self):
        rec = normalize_position(_make_position())
        assert rec.venue == "mt5"
        assert rec.symbol == "BTCUSDT"
        assert rec.side == "LONG"
        assert rec.is_open is True

    def test_decimal_to_float(self):
        rec = normalize_position(_make_position())
        assert isinstance(rec.volume, float)
        assert isinstance(rec.entry_price, float)
        assert isinstance(rec.unrealized_pnl, float)


class TestNormalizeFill:
    def test_basic_fields(self):
        rec = normalize_fill(_make_fill())
        assert rec.venue == "mt5"
        assert rec.fill_id == "f1"
        assert isinstance(rec.price, float)
        assert rec.price == 50010.0


class TestNormalizeHealth:
    def test_basic_fields(self):
        rec = normalize_health(_make_health())
        assert rec.venue == "mt5"
        assert rec.terminal_connected is True
        assert rec.latency_ms == 5.2


class TestAccountToDict:
    def test_returns_dict(self):
        d = account_to_dict(_make_account())
        assert isinstance(d, dict)
        assert d["venue"] == "mt5"
        assert d["login_id"] == "12345"
        assert d["leverage"] == 100

    def test_decimal_to_float(self):
        d = account_to_dict(_make_account())
        assert isinstance(d["equity"], float)
        assert isinstance(d["balance"], float)
        assert d["equity"] == 10000.0


class TestBrokerFillToExchangeFill:
    def test_shape(self):
        result = broker_fill_to_exchange_fill(_make_fill())
        assert result["order_id"] == "b1"
        assert result["symbol"] == "BTCUSDT"
        assert result["side"] == "BUY"
        assert result["quantity"] == Decimal("0.1")
        assert result["fill_price"] == Decimal("50010")
        assert result["filled_at"] == 1000
