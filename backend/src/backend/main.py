from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from prometheus_fastapi_instrumentator import Instrumentator

from backend.api import router as api_router
from backend.api.health import router as health_router
from backend.api.middleware import CorrelationIdMiddleware
from backend.api.stats import router as stats_router
from backend.api.ws.routes import router as ws_router
from backend.core.config import settings
from backend.core.db import engine
from backend.core.error_handlers import register_error_handlers
from backend.core.lifespan import lifespan
from shared.logging import configure_logging

configure_logging(settings.log)

app = FastAPI(
    title="Crypto Alerts Backend Service",
    lifespan=lifespan,
)
app.add_middleware(CorrelationIdMiddleware)
register_error_handlers(app)
app.include_router(api_router)
app.include_router(health_router)
app.include_router(ws_router)
app.include_router(stats_router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# instrumentation needs the app/engine to exist — hence after creation.
# excluded_urls keeps scrape and probe traffic out of the traces.
FastAPIInstrumentor.instrument_app(app, excluded_urls="/metrics,/healthz,/readyz")
SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
RedisInstrumentor().instrument()
