"""Taskiq broker, result backend and scheduler.

Worker process:    taskiq worker backend.tasks.broker:broker backend.tasks.email ...
Scheduler process: taskiq scheduler backend.tasks.broker:scheduler
Tasks follow the consumers/ rules: one task = one unit of work,
sessions via AsyncSessionLocal, JSON-serializable arguments only.
"""

from taskiq import TaskiqEvents, TaskiqScheduler, TaskiqState
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_aio_pika import AioPikaBroker
from taskiq_redis import RedisAsyncResultBackend

from backend.core.config import settings
from backend.tasks.middlewares import CorrelationTaskiqMiddleware
from shared.logging import configure_logging
from shared.tracing import configure_tracing

broker = (
    AioPikaBroker(
        url=settings.rabbitmq.url,
        queue_name="taskiq.tasks",
    )
    .with_result_backend(
        RedisAsyncResultBackend(settings.redis.url, result_ex_time=3600),
    )
    .with_middlewares(
        CorrelationTaskiqMiddleware(),
    )
)


@broker.on_event(TaskiqEvents.WORKER_STARTUP)
async def _setup_worker_observability(state: TaskiqState) -> None:
    # Only in the actual worker process: importing this module from the
    # API (AuthService -> tasks.email -> broker) must not configure
    # anything — set_tracer_provider is one-shot and the first caller wins.
    configure_logging(settings.log)
    configure_tracing("worker", settings.otel)


scheduler = TaskiqScheduler(
    broker=broker,
    sources=[LabelScheduleSource(broker=broker)],
)
