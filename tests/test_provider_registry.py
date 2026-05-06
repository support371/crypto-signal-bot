import json

from backend.logic.provider_registry import Provider, ProviderCategory, ProviderRegistry


def test_registry_load_and_update(tmp_path):
    file_path = tmp_path / "providers.json"
    file_path.write_text(
        json.dumps(
            {
                "coingecko": {
                    "category": "data",
                    "markets": ["crypto"],
                    "status": "up",
                    "last_update_ts": None,
                }
            }
        ),
        encoding="utf-8",
    )

    registry = ProviderRegistry(file_path)
    providers = {provider.name: provider for provider in registry.list_providers()}
    assert "coingecko" in providers
    assert providers["coingecko"].status == "up"

    registry.add_or_update(
        Provider(
            name="yahoo",
            category=ProviderCategory.NEWS,
            markets=["equities"],
            status="up",
        )
    )

    reloaded = ProviderRegistry(file_path)
    assert reloaded.get("yahoo") is not None
    assert reloaded.get("yahoo").status == "up"

    reloaded.update_status("yahoo", "degraded")
    assert reloaded.get("yahoo").status == "degraded"
