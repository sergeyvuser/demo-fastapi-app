"""Shared platform kernel for all services.

Contracts (event schemas, broker topology) plus the common runtime
foundation: settings base, logging and tracing setup, infra configs.
No business logic, no service-private config (db, auth, telegram) —
everyone depends on shared, shared depends on no one.
"""
