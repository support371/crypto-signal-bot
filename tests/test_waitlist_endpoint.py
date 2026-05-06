from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routes import waitlist as waitlist_module


def test_waitlist_signup(monkeypatch, tmp_path):
    file_path = tmp_path / "waitlist.json"
    monkeypatch.setattr(waitlist_module, "_get_waitlist_path", lambda: file_path)

    app = FastAPI()
    app.include_router(waitlist_module.waitlist_router)
    client = TestClient(app)

    response = client.post("/api/v1/waitlist", json={"email": "alice@example.com"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    duplicate = client.post("/api/v1/waitlist", json={"email": "alice@example.com"})
    assert duplicate.status_code == 400

    invalid = client.post("/api/v1/waitlist", json={"email": "not-an-email"})
    assert invalid.status_code == 400
