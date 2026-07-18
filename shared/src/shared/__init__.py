"""Contracts shared between services.

Event schemas and broker topology ONLY. No business logic, no I/O,
no dependencies on backend/ingestor/notifier — everyone depends on
shared, shared depends on no one.
"""
