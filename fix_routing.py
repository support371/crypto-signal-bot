import sys
from typing import Iterable

# We need to import the app to manipulate it
sys.path.append('.')
from backend.render_entrypoint import app

def move_spa_to_end():
    spa_route = None
    retained_routes = []
    for route in app.router.routes:
        if getattr(route, "path", None) == "/{path:path}":
            spa_route = route
            continue
        retained_routes.append(route)

    if spa_route:
        retained_routes.append(spa_route)
        app.router.routes = retained_routes
        print("Moved SPA route to the end")

# But wait, I need to do this in the file itself so it runs at runtime
