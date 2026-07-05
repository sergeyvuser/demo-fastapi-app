import granian
from fastapi import FastAPI
from granian.constants import Interfaces

app = FastAPI(title="Backend Service")


if __name__ == "__main__":
    granian.Granian(
        "main:app",
        address=settings.run.host,
        port=settings.run.port,
        interface=Interfaces.ASGI,
        reload=True,  # reload for development
    ).serve()
