from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class ProviderCategory(str, Enum):
    EXCHANGE = "exchange"
    NEWS = "news"
    EDUCATION = "education"
    DATA = "data"


@dataclass
class Provider:
    name: str
    category: ProviderCategory
    markets: List[str]
    status: str = "unknown"
    last_update_ts: Optional[float] = None

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)


class ProviderRegistry:
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
            logger.warning("Failed to decode provider registry JSON from %s", self._file_path)
            raw = {}

        if not isinstance(raw, dict):
            logger.warning("Provider registry root must be an object: %s", self._file_path)
            return

        for name, data in raw.items():
            if not isinstance(data, dict):
                logger.warning("Skipping provider %r: expected object", name)
                continue

            category_raw = data.get("category", ProviderCategory.DATA.value)
            try:
                category = ProviderCategory(category_raw)
            except ValueError:
                logger.warning("Unknown provider category %r for %r; defaulting to data", category_raw, name)
                category = ProviderCategory.DATA

            try:
                provider_name = str(data.get("name") or name)
                markets_raw = data.get("markets", [])
                markets = list(markets_raw) if isinstance(markets_raw, list) else []
                self._providers[provider_name] = Provider(
                    name=provider_name,
                    category=category,
                    markets=markets,
                    status=str(data.get("status", "unknown")),
                    last_update_ts=data.get("last_update_ts"),
                )
            except (TypeError, ValueError) as exc:
                logger.warning("Failed to load provider %r: %s", name, exc)

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
