"""Bybit market data ingestor.

One job: public WS ticker stream -> TickEvent -> "ticks" exchange.
No database, no Redis, no knowledge of alerts — consumers decide what
ticks mean. If this service is down, ticks are simply not produced;
nothing is buffered on the exchange side.
"""
