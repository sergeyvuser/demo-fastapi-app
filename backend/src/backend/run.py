import granian
from granian.constants import Interfaces

from backend.core.config import settings


def start() -> None:
    """Run Granian server"""
    granian.Granian(
        "backend.main:app",
        address=settings.run.host,
        port=settings.run.port,
        interface=Interfaces.ASGI,
        reload=settings.run.reload,  # reload for development
    ).serve()


if __name__ == "__main__":
    start()
