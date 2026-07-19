"""Contracts shared between services.

Event schemas, broker topology, and connection-settings models for
SHARED infrastructure (rabbitmq, redis) only. No business logic, no
I/O, no service-private config (db, auth, telegram) — everyone depends
on shared, shared depends on no one.
"""
