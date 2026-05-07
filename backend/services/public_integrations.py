from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

ProviderCategory = Literal[
    "market_data",
    "forex_data",
    "education",
    "news",
    "analytics",
    "community",
]

ProviderStatus = Literal["planned", "available", "manual_review_required"]


@dataclass(frozen=True)
class PublicIntegrationProvider:
    id: str
    name: str
    category: ProviderCategory
    purpose: str
    public_url: str
    status: ProviderStatus = "planned"
    execution_source: bool = False
    notes: str = ""

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


PUBLIC_INTEGRATION_PROVIDERS: tuple[PublicIntegrationProvider, ...] = (
    PublicIntegrationProvider(
        id="yahoo_finance",
        name="Yahoo Finance",
        category="market_data",
        purpose="Public-facing market summaries, watchlist context, ticker discovery, and marketing-page quote enrichment.",
        public_url="https://finance.yahoo.com/",
        notes="Use only as a public/marketing data reference unless a licensed API/data agreement is configured.",
    ),
    PublicIntegrationProvider(
        id="forex_com",
        name="FOREX.com",
        category="forex_data",
        purpose="FX/CFD education, macro-market context, and public forex-market reference links for marketing surfaces.",
        public_url="https://www.forex.com/",
        notes="Not an execution venue for the crypto engine. Keep separate from Bitget/BTCC/Binance adapters.",
    ),
    PublicIntegrationProvider(
        id="investopedia",
        name="Investopedia",
        category="education",
        purpose="Educational glossary, risk terminology, beginner explanations, and public learning links.",
        public_url="https://www.investopedia.com/",
        notes="Education/reference only. Do not use as a market-data or trading-signal source.",
    ),
    PublicIntegrationProvider(
        id="tradingview",
        name="TradingView",
        category="analytics",
        purpose="Public charting, technical-analysis embed planning, and market visualization references.",
        public_url="https://www.tradingview.com/",
        notes="Chart/visual layer only unless a formal data/widget integration is configured.",
    ),
    PublicIntegrationProvider(
        id="coingecko",
        name="CoinGecko",
        category="market_data",
        purpose="Public crypto asset discovery, market-cap context, and non-execution quote enrichment.",
        public_url="https://www.coingecko.com/",
        notes="Suitable for public informational context; execution decisions must continue using engine-approved market data.",
    ),
    PublicIntegrationProvider(
        id="coinmarketcap",
        name="CoinMarketCap",
        category="market_data",
        purpose="Crypto market-ranking context, public asset pages, and marketing reference links.",
        public_url="https://coinmarketcap.com/",
        notes="Public/marketing context only unless an approved API key and data-use policy are configured.",
    ),
    PublicIntegrationProvider(
        id="open_guardians",
        name="OpenGuardians",
        category="community",
        purpose="Public project positioning around guardian/risk-first autonomous controls.",
        public_url="https://openguardians.ai/",
        notes="Brand/community reference from the build brief. Keep separate from runtime guardian service logic.",
    ),
)


def list_public_integration_providers(category: ProviderCategory | None = None) -> list[dict[str, object]]:
    providers = PUBLIC_INTEGRATION_PROVIDERS
    if category:
        providers = tuple(provider for provider in providers if provider.category == category)
    return [provider.to_dict() for provider in providers]


def get_public_integration_provider(provider_id: str) -> dict[str, object] | None:
    normalized_id = provider_id.strip().lower()
    for provider in PUBLIC_INTEGRATION_PROVIDERS:
        if provider.id == normalized_id:
            return provider.to_dict()
    return None
