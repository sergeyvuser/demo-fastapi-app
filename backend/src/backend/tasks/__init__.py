"""Background jobs executed by the Taskiq worker.

Unlike consumers/, this package IS imported by the API — but only to
enqueue (`task.kiq(...)`). Execution always happens in the separate
worker process; the scheduler process only enqueues cron-labelled
tasks, it never runs them.

Rules:
- arguments must be JSON-serializable primitives — never ORM objects:
  the call is serialized through the broker, and by the time the worker
  picks it up an ORM object would be a stale, detached snapshot;
- one task = one unit of work: own session via AsyncSessionLocal, own
  commit — the API's request-scoped session does not reach here;
- retries make every task at-least-once, so keep them idempotent;
- a new task module stays invisible until it is added to the worker's
  module list (Makefile `worker` target AND the compose command) —
  until then its jobs silently pile up in the queue.
"""
