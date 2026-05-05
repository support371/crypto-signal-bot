"""
Integration status API.

Exposes provider health/status metadata for the public site and command centre.
"""

from fastapi import APIRouter

from backend.logic.provider_registry import load_registry


integrations_router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


@integrations_router.get("/status", response_model=dict)
def get_integration_status() -> dict:
    """Return status for all registered providers."""
    registry = load_registry()
    return {"providers": [p.to_dict() for p in registry.list_providers()]}
