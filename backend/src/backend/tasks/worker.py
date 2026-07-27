"""Entry point for the taskiq worker and scheduler processes.

Side effects at import are intentional here: this module is imported by
the taskiq CLI only — never by application code. The shared broker.py
must stay side effect free.
"""

from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

from backend.core.config import settings
from backend.core.db import engine
from backend.tasks.broker import broker, scheduler
from shared.logging import configure_logging
from shared.tracing import configure_tracing

configure_logging(settings.log)
configure_tracing("worker", settings.otel)

SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
RedisInstrumentor().instrument()

__all__ = ["broker", "scheduler"]
