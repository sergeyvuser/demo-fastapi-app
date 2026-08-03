"""Entry-point boilerplate shared by the services.

Not for the API: granian forks a worker, and the tracing provider must be
built AFTER the fork (its export thread does not survive one), so main.py
configures logging at import and tracing inside the lifespan.
"""

from shared.config import BaseServiceSettings
from shared.logging import configure_logging
from shared.tracing import configure_tracing


def configure_service(name: str, settings: BaseServiceSettings) -> None:
    """Bring up the cross-cutting concerns of a service process."""
    configure_logging(cfg=settings.log)
    configure_tracing(service_name=name, cfg=settings.otel)
