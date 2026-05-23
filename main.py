"""Root ASGI compatibility entrypoint for hosts that start `main:app`."""

from backend.render_entrypoint import app

__all__ = ["app"]
