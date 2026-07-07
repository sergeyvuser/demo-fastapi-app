import granian
from fastapi import FastAPI
from granian.constants import Interfaces

from backend.api import router as api_router
from backend.core.config import settings

app = FastAPI(title="Backend Service")
app.include_router(
    api_router,
    prefix=settings.api.prefix,
)


if __name__ == "__main__":
    granian.Granian(
        "main:app",
        address=settings.run.host,
        port=settings.run.port,
        interface=Interfaces.ASGI,
        reload=settings.run.reload,  # reload for development
    ).serve()
