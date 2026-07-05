import granian
from fastapi import FastAPI
from granian.constants import Interfaces

app = FastAPI(title="Backend Service")


if __name__ == "__main__":
    granian.Granian(
        "main:app",
        address="127.0.0.1",
        port=8080,
        interface=Interfaces.ASGI,
        reload=True,  # reload for development
    ).serve()
