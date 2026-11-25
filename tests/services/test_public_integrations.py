# tests/services/test_public_integrations.py
"""
Tests for the public integration provider registry.
"""

from __future__ import annotations

from backend.services.public_integrations import (
    PUBLIC_INTEGRATION_PROVIDERS,
    get_public_integration_provider,
    list_public_integration_providers,
)


class TestListProviders:
    def test_returns_all_providers_unfiltered(self):
        result = list_public_integration_providers()
        assert len(result) == len(PUBLIC_INTEGRATION_PROVIDERS)
        assert all(isinstance(p, dict) for p in result)

    def test_filter_by_market_data(self):
        result = list_public_integration_providers(category="market_data")
        assert len(result) >= 2
        assert all(p["category"] == "market_data" for p in result)

    def test_filter_by_education(self):
        result = list_public_integration_providers(category="education")
        assert len(result) >= 1
        assert all(p["category"] == "education" for p in result)

    def test_filter_nonexistent_category_returns_empty(self):
        result = list_public_integration_providers(category="forex_data")
        assert isinstance(result, list)


class TestGetProvider:
    def test_known_provider_found(self):
        result = get_public_integration_provider("coingecko")
        assert result is not None
        assert result["id"] == "coingecko"
        assert result["name"] == "CoinGecko"

    def test_unknown_provider_returns_none(self):
        result = get_public_integration_provider("nonexistent_provider")
        assert result is None

    def test_id_normalization_strips_and_lowercases(self):
        result = get_public_integration_provider("  CoinGecko  ")
        assert result is not None
        assert result["id"] == "coingecko"

    def test_all_providers_have_required_fields(self):
        for provider in PUBLIC_INTEGRATION_PROVIDERS:
            d = provider.to_dict()
            assert "id" in d
            assert "name" in d
            assert "category" in d
            assert "purpose" in d
            assert "public_url" in d
            assert "status" in d

    def test_no_provider_is_execution_source(self):
        for provider in PUBLIC_INTEGRATION_PROVIDERS:
            assert provider.execution_source is False
