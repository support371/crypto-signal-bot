from __future__ import annotations

from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]


def _render_env() -> dict[str, object]:
    payload = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    service = payload["services"][0]
    return {item["key"]: item.get("value") for item in service["envVars"]}


def test_render_blueprint_is_paper_only():
    env = _render_env()

    assert env["TRADING_MODE"] == "paper"
    assert env["EXCHANGE_MODE"] == "paper"
    assert env["NETWORK"] == "testnet"
    assert env["ALLOW_MAINNET"] == "false"


def test_render_blueprint_uses_public_data_adapter_only():
    env = _render_env()

    assert env["EXCHANGE"] == "coingecko"
    assert env["MARKET_DATA_PUBLIC_EXCHANGE"] == "coingecko"
    assert env["PAPER_USE_LIVE_MARKET_DATA"] == "true"


def test_render_blueprint_cors_has_no_wildcards():
    env = _render_env()
    origins = str(env["CORS_ORIGINS"])

    assert "*" not in origins
    assert origins == "https://crypto-signal-bot-indol.vercel.app"


def test_render_startup_uses_hardened_entrypoint():
    source = (REPO_ROOT / "render_start.py").read_text(encoding="utf-8")

    assert 'TARGET = "backend.render_entrypoint:app"' in source
    assert '"backend.app:app"' not in source
    assert '"backend.health_wrapper:app"' not in source
