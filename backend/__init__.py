"""Backend package bootstrap hooks."""

from fastapi import FastAPI

_ORIGINAL_FASTAPI_INIT = FastAPI.__init__
_PUBLIC_ROUTERS_PATCHED = False


def _patched_fastapi_init(self, *args, **kwargs):
    _ORIGINAL_FASTAPI_INIT(self, *args, **kwargs)
    title = kwargs.get("title") or (args[0] if args else "")
    if title != "Crypto Signal Bot — Trading Backend":
        return

    from backend.routes.compatibility import compatibility_router
    from backend.routes.integrations import integrations_router
    from backend.routes.waitlist import waitlist_router

    existing_paths = {getattr(route, "path", None) for route in self.routes}
    for router in (compatibility_router, integrations_router, waitlist_router):
        router_paths = {getattr(route, "path", None) for route in router.routes}
        if not router_paths.issubset(existing_paths):
            self.include_router(router)
            existing_paths.update(router_paths)


if not getattr(FastAPI, "_crypto_signal_bot_public_routes_patch", False):
    FastAPI.__init__ = _patched_fastapi_init
    FastAPI._crypto_signal_bot_public_routes_patch = True
