"""Taskiq broker, result backend and scheduler.

Worker process:    taskiq worker backend.tasks.broker:broker backend.tasks.email ...
Scheduler process: taskiq scheduler backend.tasks.broker:scheduler
Tasks follow the consumers/ rules: one task = one unit of work,
sessions via AsyncSessionLocal, JSON-serializable arguments only.
"""

from taskiq import TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_aio_pika import AioPikaBroker
from taskiq_redis import RedisAsyncResultBackend

from backend.core.config import settings

broker = AioPikaBroker(
    url=settings.rabbitmq.url,
    queue_name="taskiq.tasks",
).with_result_backend(
    RedisAsyncResultBackend(settings.redis.url, result_ex_time=3600),
)


scheduler = TaskiqScheduler(
    broker=broker,
    sources=[LabelScheduleSource(broker=broker)],
)
