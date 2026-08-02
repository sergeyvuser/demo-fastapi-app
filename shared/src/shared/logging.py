"""Structured logging: JSON sink + correlation id propagated everywhere.

The correlation id ties together every log line produced while handling
one logical operation — across HTTP, tasks and broker consumers.
"""

import contextvars
import inspect
import logging
import sys
import traceback
from typing import TYPE_CHECKING, Any

import orjson
from loguru import logger
from opentelemetry import trace

from shared.config import LogConfig

if TYPE_CHECKING:
    from loguru import Message, Record

correlation_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlation_id",
    default="-",
)


def _json_sink(message: Message) -> None:
    """Emit a flat, query-friendly line: OTel-ish field names, extras inlined."""
    record = message.record
    payload: dict[str, Any] = {
        "timestamp": record["time"].isoformat(),
        "level": record["level"].name,
        "message": record["message"],
        "logger": f"{record['name']}:{record['function']}:{record['line']}",
        **record["extra"],  # correlation_id, trace_id, alert_id, user_id, ...
    }
    exc = record["exception"]
    if exc is not None:
        payload["exception"] = {
            "type": exc.type.__name__ if exc.type else None,
            "value": str(exc.value),
            "traceback": "".join(
                traceback.format_exception(exc.type, exc.value, exc.traceback)
            ),
        }
    # orjson returns bytes and appends no newline
    sys.stdout.buffer.write(orjson.dumps(payload, default=str) + b"\n")
    sys.stdout.buffer.flush()


def _patch(record: Record) -> None:
    # inject current correlation id into every record's extra
    record["extra"]["correlation_id"] = correlation_id.get()
    ctx = trace.get_current_span().get_span_context()
    record["extra"]["trace_id"] = format(ctx.trace_id, "032x") if ctx.is_valid else "-"


class InterceptHandler(logging.Handler):
    """Redirect stdlib logging (granian, sqlalchemy, aio-pika) into loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Walk out of logging's own frames to find the real caller.
        # `depth == 0 or` forces at least one hop out of emit() itself.
        frame, depth = inspect.currentframe(), 0
        while frame and (depth == 0 or frame.f_code.co_filename == logging.__file__):
            frame = frame.f_back
            depth += 1

        (
            logger.opt(depth=depth, exception=record.exc_info).log(
                level, record.getMessage()
            )
        )


def configure_logging(cfg: LogConfig) -> None:
    logger.remove()
    logger.configure(patcher=_patch)  # inject correlation_id into every record
    if cfg.json_format:
        # containers: structured stdout, platform handles collection
        logger.add(
            _json_sink,
            level=cfg.level,
            enqueue=True,
        )
    else:
        # local dev: human-readable, correlation id visible
        logger.add(
            sys.stdout,
            level=cfg.level,
            format="{time:HH:mm:ss} | {level: <8} | [{extra[correlation_id]}] "
            "{name}:{function}:{line} - {message}",
            colorize=True,
            enqueue=True,
        )
    logging.basicConfig(handlers=[InterceptHandler()], level=logging.INFO, force=True)
    # httpx logs full request URLs at INFO — telegram puts the bot token in the path
    for noisy in ("httpx", "aiormq", "aio_pika"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
