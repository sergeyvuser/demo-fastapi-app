import uuid

from taskiq import TaskiqMessage, TaskiqMiddleware

from shared.logging import correlation_id


class CorrelationTaskiqMiddleware(TaskiqMiddleware):
    """Carry the correlation id through the task queue.

    pre_send runs where the task is enqueued (api or scheduler),
    pre_execute runs in the worker.
    """

    def pre_send(self, message: TaskiqMessage) -> TaskiqMessage:
        cid = correlation_id.get()
        if cid == "-":  # no upstream context (cron) — start a chain
            cid = uuid.uuid4().hex
        message.labels["correlation_id"] = cid
        return message

    def pre_execute(self, message: TaskiqMessage) -> TaskiqMessage:
        correlation_id.set(message.labels.get("correlation_id", "-"))
        return message
