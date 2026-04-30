from backend.db.event_log import EventLogStore


def test_event_log_store_appends_and_reads_recent_events(tmp_path):
    store = EventLogStore(tmp_path / "events.db")

    first_id = store.append("audit.created", {"order_id": "one"}, created_at=10)
    second_id = store.append("audit.created", {"order_id": "two"}, created_at=20)

    assert first_id == 1
    assert second_id == 2
    assert store.count() == 2

    recent = store.recent(limit=10)
    assert [event["id"] for event in recent] == [2, 1]
    assert recent[0]["kind"] == "audit.created"
    assert recent[0]["payload"] == {"order_id": "two"}


def test_event_log_store_caps_recent_limit(tmp_path):
    store = EventLogStore(tmp_path / "events.db")
    store.append("x", {"n": 1}, created_at=1)

    assert len(store.recent(limit=0)) == 1
