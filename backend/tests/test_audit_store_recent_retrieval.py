"""Focused regression tests for recent audit trace retrieval."""

from backend.logic import audit_store


def _reset_store(monkeypatch, tmp_path):
    monkeypatch.setenv("AUDIT_STORE_PATH", str(tmp_path / "audit.json"))
    monkeypatch.setenv("EVENT_LOG_ENABLED", "false")
    audit_store._cache = None
    audit_store._event_log_store_instance = None
    audit_store.clear_audit()


def test_recent_unfiltered_traces_preserve_chronological_order(monkeypatch, tmp_path):
    _reset_store(monkeypatch, tmp_path)
    for index in range(8):
        audit_store.append_trace({"intent_id": f"intent-{index}", "sequence": index})

    traces = audit_store.get_traces(limit=3)

    assert [trace["sequence"] for trace in traces] == [5, 6, 7]


def test_recent_filtered_traces_stop_at_requested_limit(monkeypatch, tmp_path):
    _reset_store(monkeypatch, tmp_path)
    for index in range(10):
        audit_store.append_trace(
            {
                "intent_id": f"intent-{index}",
                "sequence": index,
                "symbol": "BTCUSDT" if index % 2 == 0 else "ETHUSDT",
                "execution": {"status": "FILLED" if index % 3 == 0 else "FAILED"},
            }
        )

    traces = audit_store.get_traces(symbol="btcusdt", limit=2)

    assert [trace["sequence"] for trace in traces] == [6, 8]


def test_symbol_and_status_filters_are_combined(monkeypatch, tmp_path):
    _reset_store(monkeypatch, tmp_path)
    fixtures = [
        {"intent_id": "1", "symbol": "BTCUSDT", "execution": {"status": "FAILED"}},
        {"intent_id": "2", "symbol": "ETHUSDT", "execution": {"status": "FILLED"}},
        {"intent_id": "3", "symbol": "BTCUSDT", "execution": {"status": "FILLED"}},
    ]
    for trace in fixtures:
        audit_store.append_trace(trace)

    traces = audit_store.get_traces(symbol="BTCUSDT", status="FILLED", limit=10)

    assert [trace["intent_id"] for trace in traces] == ["3"]


def test_nonpositive_limit_returns_empty_result(monkeypatch, tmp_path):
    _reset_store(monkeypatch, tmp_path)
    audit_store.append_trace({"intent_id": "intent-1"})

    assert audit_store.get_traces(limit=0) == []
    assert audit_store.get_traces(limit=-1) == []


def test_intent_lookup_returns_newest_matching_trace(monkeypatch, tmp_path):
    _reset_store(monkeypatch, tmp_path)
    audit_store.append_trace({"intent_id": "duplicate", "revision": 1})
    audit_store.append_trace({"intent_id": "other", "revision": 1})
    audit_store.append_trace({"intent_id": "duplicate", "revision": 2})

    trace = audit_store.get_trace_by_intent_id("duplicate")

    assert trace is not None
    assert trace["revision"] == 2
