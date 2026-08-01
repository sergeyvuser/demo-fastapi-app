"""Taskiq broker, result backend and scheduler.

Worker process:    taskiq worker backend.tasks.broker:broker backend.tasks.email ...
Scheduler process: taskiq scheduler backend.tasks.broker:scheduler
Tasks follow the consumers/ rules: one task = one unit of work,
sessions via AsyncSessionLocal, JSON-serializable arguments only.
"""

from taskiq import AsyncBroker, InMemoryBroker, TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_aio_pika import AioPikaBroker
from taskiq_redis import RedisAsyncResultBackend

from backend.core.config import settings
from backend.tasks.middlewares import CorrelationTaskiqMiddleware


def _make_broker() -> AsyncBroker:
    # Documented taskiq testing recipe: tasks are registered in the registry
    # of THEIR broker, so a test cannot borrow them into another one —
    # the broker itself has to be the in-memory double.
    # await_inplace: .kiq() runs the task inline, no worker, no waiting.
    if settings.testing:
        return InMemoryBroker(await_inplace=True)

    return AioPikaBroker(
        url=settings.rabbitmq.url,
        queue_name="taskiq.tasks",
    ).with_result_backend(
        RedisAsyncResultBackend(
            settings.redis.url,
            result_ex_time=3600,
        ),
    )


broker: AsyncBroker = _make_broker().with_middlewares(CorrelationTaskiqMiddleware())

scheduler = TaskiqScheduler(
    broker=broker,
    sources=[LabelScheduleSource(broker=broker)],
)
