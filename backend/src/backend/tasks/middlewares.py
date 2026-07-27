import uuid

from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.propagate import extract, inject
from opentelemetry.trace import Status, StatusCode
from taskiq import TaskiqMessage, TaskiqMiddleware, TaskiqResult

from shared.logging import correlation_id


class CorrelationTaskiqMiddleware(TaskiqMiddleware):
    """Carry the correlation id through the task queue.

    pre_send runs where the task is enqueued (api or scheduler),
    pre_execute runs in the worker.
    """

    def __init__(self) -> None:
        super().__init__()
        self._spans: dict[str, tuple] = {}

    def pre_send(self, message: TaskiqMessage) -> TaskiqMessage:
        cid = correlation_id.get()
        if cid == "-":  # no upstream context (cron) — start a chain
            cid = uuid.uuid4().hex
        message.labels["correlation_id"] = cid
        # carry W3C traceparent so the worker continues the same trace
        carrier: dict[str, str] = {}
        inject(carrier)
        message.labels.update(carrier)
        return message

    def pre_execute(self, message: TaskiqMessage) -> TaskiqMessage:
        correlation_id.set(message.labels.get("correlation_id", "-"))
        parent = extract(message.labels)
        span = trace.get_tracer("taskiq").start_span(
            f"task {message.task_name}", context=parent
        )
        token = otel_context.attach(trace.set_span_in_context(span))
        self._spans[message.task_id] = (span, token)
        return message

    def post_execute(self, message: TaskiqMessage, result: TaskiqResult) -> None:
        entry = self._spans.pop(message.task_id, None)
        if entry is None:
            return
        span, token = entry
        if result.is_err:
            span.set_status(Status(StatusCode.ERROR))
        otel_context.detach(token)
        span.end()
