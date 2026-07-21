"""Traversal and locking contracts for optimized audit trace retrieval."""

from collections.abc import Sequence
from typing import Any

import pytest

from backend.logic import audit_store


class _TrackingTraceSequence(Sequence[dict[str, Any]]):
    def __init__(self, items: list[dict[str, Any]]) -> None:
        self._items = items
        self.accesses: list[int | slice] = []

    def __len__(self) -> int:
        return len(self._items)

    def __getitem__(self, index: int | slice):
        assert audit_store._lock.locked(), "trace storage must only be read while holding the audit lock"
        self.accesses.append(index)
        return self._items[index]


def _install_traces(traces: Sequence[dict[str, Any]]) -> None:
    audit_store._cache = {
        "intents": [],
        "orders": [],
        "withdrawals": [],
        "risk_events": [],
        "traces": traces,
    }


@pytest.fixture(autouse=True)
def _isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("AUDIT_STORE_PATH", str(tmp_path / "audit.json"))
    monkeypatch.setenv("EVENT_LOG_ENABLED", "false")
    audit_store._cache = None
    audit_store._event_log_store_instance = None
    yield
    audit_store._cache = None
    audit_store._event_log_store_instance = None


def test_unfiltered_retrieval_uses_one_bounded_tail_slice() -> None:
    traces = _TrackingTraceSequence(
        [{"intent_id": f"intent-{index}"} for index in range(6)]
    )
    _install_traces(traces)

    result = audit_store.get_traces(limit=2)

    assert [trace["intent_id"] for trace in result] == ["intent-4", "intent-5"]
    assert traces.accesses == [slice(-2, None, None)]
    assert not audit_store._lock.locked()


def test_filtered_retrieval_stops_after_newest_requested_matches() -> None:
    traces = _TrackingTraceSequence(
        [
            {"intent_id": "old-0", "symbol": "ETHUSDT"},
            {"intent_id": "old-1", "symbol": "ETHUSDT"},
            {"intent_id": "old-2", "symbol": "BTCUSDT"},
            {"intent_id": "old-3", "symbol": "ETHUSDT"},
            {"intent_id": "new-4", "symbol": "BTCUSDT"},
            {"intent_id": "new-5", "symbol": "BTCUSDT"},
        ]
    )
    _install_traces(traces)

    result = audit_store.get_traces(symbol="btcusdt", limit=2)

    assert [trace["intent_id"] for trace in result] == ["new-4", "new-5"]
    assert traces.accesses == [5, 4]
    assert not audit_store._lock.locked()


def test_combined_filters_stop_after_newest_requested_matches() -> None:
    traces = _TrackingTraceSequence(
        [
            {
                "intent_id": "old-0",
                "symbol": "BTCUSDT",
                "execution": {"status": "FILLED"},
            },
            {
                "intent_id": "old-1",
                "symbol": "ETHUSDT",
                "execution": {"status": "FILLED"},
            },
            {
                "intent_id": "old-2",
                "symbol": "BTCUSDT",
                "execution": {"status": "FAILED"},
            },
            {
                "intent_id": "new-3",
                "symbol": "BTCUSDT",
                "execution": {"status": "FILLED"},
            },
            {
                "intent_id": "new-4",
                "symbol": "ETHUSDT",
                "execution": {"status": "FILLED"},
            },
            {
                "intent_id": "new-5",
                "symbol": "BTCUSDT",
                "execution": {"status": "FILLED"},
            },
        ]
    )
    _install_traces(traces)

    result = audit_store.get_traces(
        symbol="btcusdt",
        status="FILLED",
        limit=2,
    )

    assert [trace["intent_id"] for trace in result] == ["new-3", "new-5"]
    assert traces.accesses == [5, 4, 3]
    assert not audit_store._lock.locked()


def test_intent_lookup_stops_at_newest_duplicate() -> None:
    traces = _TrackingTraceSequence(
        [
            {"intent_id": "duplicate", "revision": 1},
            {"intent_id": "other", "revision": 1},
            {"intent_id": "duplicate", "revision": 2},
            {"intent_id": "newest-other", "revision": 1},
        ]
    )
    _install_traces(traces)

    result = audit_store.get_trace_by_intent_id("duplicate")

    assert result == {"intent_id": "duplicate", "revision": 2}
    assert traces.accesses == [3, 2]
    assert not audit_store._lock.locked()


def test_nonpositive_limit_does_not_load_storage(monkeypatch) -> None:
    def fail_load():
        raise AssertionError("storage must not be loaded for a nonpositive limit")

    monkeypatch.setattr(audit_store, "_load", fail_load)

    assert audit_store.get_traces(limit=0) == []
    assert audit_store.get_traces(limit=-1) == []
