"""FastStream message consumers.

Each module here is a separate PROCESS entry point (run via
`faststream run backend.consumers.<module>:app`) — nothing in this
package is imported by the API application.

Rules:
- one message = one unit of work: open a session, run a service,
  commit inside the service, ack happens only if the handler returns;
- broker I/O (publish) lives here, not in services — services return
  event objects and stay testable without RabbitMQ.
"""
