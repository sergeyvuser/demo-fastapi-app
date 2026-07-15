"""HTTP layer: routers, versioning, request-scoped dependencies.

Routes stay thin: validate input via schemas, call a service, return a
schema. No business rules and no direct repository access here.
"""

__all__ = [
    "router",
]
from .api import router
