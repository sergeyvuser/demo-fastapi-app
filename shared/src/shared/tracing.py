"""OpenTelemetry setup shared by all services.

Each process registers itself as a separate service in Jaeger; spans are
linked across processes automatically via context propagation (HTTP
headers, AMQP message headers).
"""

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from shared.config import OtelConfig


def configure_tracing(service_name: str, cfg: OtelConfig) -> None:
    if not cfg.enabled:
        return
    provider = TracerProvider(resource=Resource.create({SERVICE_NAME: service_name}))
    # Batch: spans are buffered and exported in background — never blocks
    # the request/message handler.
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=cfg.endpoint, insecure=True))
    )
    trace.set_tracer_provider(provider)
