from fastapi import FastAPI
from granian.utils.proxies import wrap_asgi_with_proxy_headers
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

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
# add_middleware inserts at position 0, so the LAST one added runs FIRST.
# Order below is deliberate, read it bottom-up: reject a spoofed Host before
# doing any work, then CORS, then correlation id around the actual handling.
if settings.run.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.run.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
if settings.run.allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.run.allowed_hosts)
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

# `app` stays the FastAPI instance (tests and dependency_overrides use it);
# granian serves the wrapped object.
asgi_app = (
    wrap_asgi_with_proxy_headers(app, trusted_hosts=settings.run.trusted_proxies)
    if settings.run.trusted_proxies
    else app
)
