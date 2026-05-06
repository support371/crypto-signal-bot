from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.db.event_log import EventLogStore
from backend.routes.event_log import router


def build_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_event_log_status_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOG_ENABLED", "false")
    monkeypatch.setenv("EVENT_LOG_PATH", str(tmp_path / "events.db"))

    response = build_client().get("/event-log/status")

    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["ok"] is True
    assert body["count"] is None


def test_event_log_list_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOG_ENABLED", "false")
    monkeypatch.setenv("EVENT_LOG_PATH", str(tmp_path / "events.db"))

    response = build_client().get("/event-log")

    assert response.status_code == 404


def test_event_log_status_and_list_enabled(monkeypatch, tmp_path):
    path = tmp_path / "events.db"
    monkeypatch.setenv("EVENT_LOG_ENABLED", "true")
    monkeypatch.setenv("EVENT_LOG_PATH", str(path))
    store = EventLogStore(path)
    store.append("audit.order", {"id": "order-1"}, created_at=123)

    client = build_client()
    status_response = client.get("/event-log/status")
    list_response = client.get("/event-log")

    assert status_response.status_code == 200
    assert status_response.json()["count"] == 1
    assert list_response.status_code == 200
    assert list_response.json()["events"] == [
        {
            "id": 1,
            "kind": "audit.order",
            "created_at": 123,
            "payload": {"id": "order-1"},
        }
    ]
