from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from loguru import logger

from backend.core.exceptions import AppError


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.bind(
        status=exc.status_code,
        path=request.url.path,
        error=type(exc).__name__,
    ).log(
        "ERROR" if exc.status_code >= 500 else "WARNING",
        "request failed: {}",
        exc.detail,
    )
    return JSONResponse(
        status_code=exc.status_code,
        media_type="application/problem+json",
        headers=exc.headers,
        content={
            "type": "about:blank",
            "title": exc.title,
            "status": exc.status_code,
            "detail": exc.detail,
            "instance": str(request.url.path),
        },
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
