"""FastAPI app entrypoint with public service routers attached."""

from backend.app import app
from backend.routes.compatibility import compatibility_router
from backend.routes.integrations import integrations_router
from backend.routes.waitlist import waitlist_router


_registered_paths = {getattr(route, "path", None) for route in app.routes}
for _router in (compatibility_router, integrations_router, waitlist_router):
    _router_paths = {getattr(route, "path", None) for route in _router.routes}
    if not _router_paths.issubset(_registered_paths):
        app.include_router(_router)
        _registered_paths.update(_router_paths)
