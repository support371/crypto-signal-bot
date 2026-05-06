import importlib

from backend.db.event_log import EventLogStore


def _reload_audit_store(monkeypatch, tmp_path, event_log_enabled=False):
    monkeypatch.setenv("AUDIT_STORE_PATH", str(tmp_path / "audit.json"))
    monkeypatch.setenv("EVENT_LOG_ENABLED", "true" if event_log_enabled else "false")
    monkeypatch.setenv("EVENT_LOG_PATH", str(tmp_path / "event_log.db"))

    import backend.logic.audit_store as audit_store

    return importlib.reload(audit_store)


def test_audit_store_keeps_json_default_when_event_log_disabled(monkeypatch, tmp_path):
    audit_store = _reload_audit_store(monkeypatch, tmp_path, event_log_enabled=False)

    audit_store.append_intent({"id": "intent-1", "symbol": "BTCUSDT"})

    data = audit_store.get_audit()
    assert data["intents"] == [{"id": "intent-1", "symbol": "BTCUSDT"}]

    event_log = EventLogStore(tmp_path / "event_log.db")
    assert event_log.count() == 0


def test_audit_store_dual_writes_when_event_log_enabled(monkeypatch, tmp_path):
    audit_store = _reload_audit_store(monkeypatch, tmp_path, event_log_enabled=True)

    audit_store.append_order({"id": "order-1", "symbol": "ETHUSDT"})
    audit_store.append_risk_event({"intent_id": "intent-1", "reason": "test"})

    data = audit_store.get_audit()
    assert data["orders"] == [{"id": "order-1", "symbol": "ETHUSDT"}]
    assert data["risk_events"][0]["intent_id"] == "intent-1"

    event_log = EventLogStore(tmp_path / "event_log.db")
    recent = event_log.recent(limit=10)
    assert event_log.count() == 2
    assert [event["kind"] for event in recent] == ["audit.risk_event", "audit.order"]
    assert recent[1]["payload"] == {"id": "order-1", "symbol": "ETHUSDT"}
