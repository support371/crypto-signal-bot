"""Tests for the venue registry (backend/engine/venue_registry.py)."""

from backend.engine.venue_registry import (
    VenueInfo,
    register_venue,
    mark_available,
    mark_unavailable,
    get_venue,
    available_venues,
    all_venues,
    is_available,
    get_broker_venues,
    get_exchange_venues,
    venues_for_symbol,
    _registry,
)


class _FakeAdapter:
    def supports_symbol(self, s):
        return s in {"BTCUSDT", "ETHUSDT"}


class TestVenueRegistry:
    def setup_method(self):
        _registry.clear()

    def test_register_venue(self):
        register_venue("test_ex", "exchange", _FakeAdapter())
        assert "test_ex" in _registry
        assert _registry["test_ex"].venue_type == "exchange"
        assert _registry["test_ex"].available is True

    def test_register_unavailable(self):
        register_venue("test_ex", "exchange", _FakeAdapter(), available=False)
        assert _registry["test_ex"].available is False

    def test_get_venue_exists(self):
        register_venue("test_ex", "exchange", _FakeAdapter())
        v = get_venue("test_ex")
        assert v is not None
        assert v.venue_id == "test_ex"

    def test_get_venue_missing(self):
        assert get_venue("nonexistent") is None

    def test_is_available(self):
        register_venue("test_ex", "exchange", _FakeAdapter())
        assert is_available("test_ex") is True

    def test_is_available_missing(self):
        assert is_available("nonexistent") is False

    def test_mark_unavailable(self):
        register_venue("test_ex", "exchange", _FakeAdapter())
        mark_unavailable("test_ex", error="connection lost")
        assert is_available("test_ex") is False
        assert _registry["test_ex"].error == "connection lost"

    def test_mark_available(self):
        register_venue("test_ex", "exchange", _FakeAdapter(), available=False)
        mark_available("test_ex", supported_symbols={"BTCUSDT"})
        assert is_available("test_ex") is True
        assert "BTCUSDT" in _registry["test_ex"].supported_symbols

    def test_all_venues(self):
        register_venue("ex1", "exchange", _FakeAdapter())
        register_venue("br1", "broker", _FakeAdapter())
        assert len(all_venues()) == 2

    def test_available_venues_filters(self):
        register_venue("ex1", "exchange", _FakeAdapter())
        register_venue("br1", "broker", _FakeAdapter(), available=False)
        avail = available_venues()
        assert len(avail) == 1
        assert avail[0].venue_id == "ex1"

    def test_get_broker_venues(self):
        register_venue("ex1", "exchange", _FakeAdapter())
        register_venue("br1", "broker", _FakeAdapter())
        brokers = get_broker_venues()
        assert len(brokers) == 1
        assert brokers[0].venue_id == "br1"

    def test_get_exchange_venues(self):
        register_venue("ex1", "exchange", _FakeAdapter())
        register_venue("br1", "broker", _FakeAdapter())
        exchanges = get_exchange_venues()
        assert len(exchanges) == 1
        assert exchanges[0].venue_id == "ex1"

    def test_venues_for_symbol(self):
        register_venue("ex1", "exchange", _FakeAdapter())
        mark_available("ex1", supported_symbols={"BTCUSDT", "ETHUSDT"})
        register_venue("br1", "broker", _FakeAdapter())
        mark_available("br1", supported_symbols={"SOLUSDT"})

        btc_venues = venues_for_symbol("BTCUSDT")
        assert any(v.venue_id == "ex1" for v in btc_venues)
        assert not any(v.venue_id == "br1" for v in btc_venues)

    def test_venues_for_symbol_empty_symbols_matches_all(self):
        register_venue("ex1", "exchange", _FakeAdapter())
        result = venues_for_symbol("ANYTHING")
        assert len(result) == 1

    def test_mark_unavailable_nonexistent_no_error(self):
        mark_unavailable("nonexistent")

    def test_mark_available_nonexistent_no_error(self):
        mark_available("nonexistent")
