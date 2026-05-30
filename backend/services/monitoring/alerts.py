# backend/services/monitoring/alerts.py
"""
Alert dispatcher — fire-and-forget, zero mandatory deps.

Supported channels (all opt-in via env vars):
  ALERT_WEBHOOK_URL   — generic HTTP POST (Discord, Slack incoming webhook, etc.)
  ALERT_SLACK_URL     — Slack incoming webhook (alias for ALERT_WEBHOOK_URL)
  ALERT_DISCORD_URL   — Discord webhook URL

If none are set, alerts are written to the structured log only.

Severity levels: INFO | WARNING | CRITICAL
"""
from __future__ import annotations

import json
import logging
import os
import time
from enum import Enum
from typing import Optional

log = logging.getLogger(__name__)

try:
    import httpx  # noqa: F401 — imported here so tests can patch at module level
except ImportError:
    httpx = None  # type: ignore[assignment]


class Severity(str, Enum):
    INFO     = "INFO"
    WARNING  = "WARNING"
    CRITICAL = "CRITICAL"


_COLOUR = {
    Severity.INFO:     0x3498DB,   # blue
    Severity.WARNING:  0xF39C12,   # orange
    Severity.CRITICAL: 0xE74C3C,   # red
}


def _webhook_urls() -> list[str]:
    urls = []
    for env in ("ALERT_WEBHOOK_URL", "ALERT_SLACK_URL", "ALERT_DISCORD_URL"):
        v = os.getenv(env, "").strip()
        if v and v not in urls:
            urls.append(v)
    return urls


def _is_discord(url: str) -> bool:
    return "discord.com" in url or "discordapp.com" in url


def _build_payload(title: str, message: str, severity: Severity) -> dict:
    ts = int(time.time())
    if _is_discord(title):   # placeholder, decided per-url below
        pass
    return {"title": title, "message": message, "severity": severity.value, "ts": ts}


async def dispatch(
    title: str,
    message: str,
    severity: Severity = Severity.WARNING,
    extra: Optional[dict] = None,
) -> None:
    """
    Dispatch an alert to all configured webhook channels.
    Always logs the alert regardless of webhook config.
    Never raises — alerting must not break the calling path.
    """
    ts = int(time.time())
    log_fn = {
        Severity.INFO:     log.info,
        Severity.WARNING:  log.warning,
        Severity.CRITICAL: log.critical,
    }.get(severity, log.warning)

    log_fn("[alert][%s] %s — %s | extra=%s", severity.value, title, message, extra)

    urls = _webhook_urls()
    if not urls:
        return

    try:
        import httpx as _httpx  # noqa: PLC0415
    except ImportError:
        log.debug("[alert] httpx not available, skipping webhook dispatch")
        return

    for url in urls:
        try:
            if _is_discord(url):
                payload = {
                    "embeds": [{
                        "title":       title,
                        "description": message,
                        "color":       _COLOUR.get(severity, 0x95A5A6),
                        "timestamp":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
                        "footer":      {"text": f"crypto-signal-bot | {severity.value}"},
                        "fields": [{"name": k, "value": str(v), "inline": True}
                                   for k, v in (extra or {}).items()],
                    }]
                }
            else:
                # Generic / Slack-compatible
                text = f"*[{severity.value}] {title}*\n{message}"
                if extra:
                    text += "\n" + "\n".join(f"• `{k}`: {v}" for k, v in extra.items())
                payload = {"text": text}

            async with _httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code >= 400:
                    log.warning("[alert] webhook %s returned %d", url[:40], resp.status_code)

        except Exception as exc:
            log.warning("[alert] dispatch to %s failed: %s", url[:40], exc)
