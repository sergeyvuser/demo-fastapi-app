from fastapi import FastAPI

from backend.api import router as api_router
from backend.core.error_handlers import register_error_handlers
from backend.core.lifespan import lifespan

app = FastAPI(
    title="Crypto Alerts Backend Service",
    lifespan=lifespan,
)
register_error_handlers(app)
app.include_router(api_router)
