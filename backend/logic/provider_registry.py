"""
Provider registry for external integrations.

This module defines a small JSON-backed registry for third-party providers
such as exchanges, market-data vendors, news sources, and education resources.
It is intentionally lightweight and can be replaced with a durable database
model as the platform scales.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional


class ProviderCategory(str, Enum):
    """Supported provider categories."""

    EXCHANGE = "exchange"
    NEWS = "news"
    EDUCATION = "education"
    DATA = "data"


@dataclass
class Provider:
    """Provider registry entry."""

    name: str
    category: ProviderCategory
    markets: List[str]
    status: str = "unknown"
    last_update_ts: Optional[float] = None

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)


class ProviderRegistry:
    """Registry for providers backed by a JSON file."""

    def __init__(self, file_path: Path) -> None:
        self._file_path = file_path
        self._providers: Dict[str, Provider] = {}
        self._load()

    def _load(self) -> None:
        if not self._file_path.exists():
            return

        try:
            raw = json.loads(self._file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raw = {}

        for name, data in raw.items():
            try:
                provider_name = str(data.get("name") or name)
                self._providers[provider_name] = Provider(
                    name=provider_name,
                    category=ProviderCategory(data.get("category", "data")),
                    markets=list(data.get("markets", [])),
                    status=str(data.get("status", "unknown")),
                    last_update_ts=data.get("last_update_ts"),
                )
            except Exception:
                continue

    def _persist(self) -> None:
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._file_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps({k: p.to_dict() for k, p in self._providers.items()}, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(self._file_path)

    def list_providers(self) -> List[Provider]:
        return list(self._providers.values())

    def get(self, name: str) -> Optional[Provider]:
        return self._providers.get(name)

    def add_or_update(self, provider: Provider) -> None:
        self._providers[provider.name] = provider
        self._persist()

    def update_status(self, name: str, status: str, ts: Optional[float] = None) -> None:
        provider = self._providers.get(name)
        if not provider:
            return
        provider.status = status
        provider.last_update_ts = ts
        self._persist()


def load_registry() -> ProviderRegistry:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return ProviderRegistry(data_dir / "providers.json")
