from faststream import BaseMiddleware

from shared.logging import correlation_id


class CorrelationMiddleware(BaseMiddleware):
    """Bridge FastStream's native correlation_id into our logging contextvar."""

    async def consume_scope(self, call_next, msg):
        # incoming message carries it (AMQP correlation_id property)
        correlation_id.set(msg.correlation_id or "-")
        return await call_next(msg)

    async def publish_scope(self, call_next, cmd):
        # outgoing message inherits the id of the chain we are in
        cid = correlation_id.get()
        if cid != "-":
            cmd.correlation_id = cid
        return await call_next(cmd)
