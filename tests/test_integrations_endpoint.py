import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.logic.provider_registry import ProviderRegistry
from backend.routes.integrations import integrations_router


def test_get_integrations_status(monkeypatch, tmp_path):
    file_path = tmp_path / "providers.json"
    file_path.write_text(
        json.dumps(
            {
                "coingecko": {
                    "category": "data",
                    "markets": ["crypto"],
                    "status": "up",
                    "last_update_ts": None,
                },
                "forexcom": {
                    "category": "data",
                    "markets": ["forex"],
                    "status": "degraded",
                    "last_update_ts": None,
                },
            }
        ),
        encoding="utf-8",
    )
    registry = ProviderRegistry(file_path)
    monkeypatch.setattr("backend.routes.integrations.load_registry", lambda: registry)

    app = FastAPI()
    app.include_router(integrations_router)
    client = TestClient(app)

    response = client.get("/api/v1/integrations/status")
    assert response.status_code == 200
    data = response.json()
    assert "providers" in data
    statuses = {provider["name"]: provider["status"] for provider in data["providers"]}
    assert statuses["coingecko"] == "up"
    assert statuses["forexcom"] == "degraded"
