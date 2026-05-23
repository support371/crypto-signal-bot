"""Root ASGI compatibility entrypoint for hosts that start `app:app`.

The canonical backend remains `backend.app`. Render and other PaaS runtimes
sometimes ignore blueprint start commands on existing services or use a root
module convention. Keeping this thin adapter makes those deployments land on the
same FastAPI application and health routes.
"""

from backend.render_entrypoint import app

__all__ = ["app"]
