"""Crypto price alerts backend.

Layered layout: api (HTTP) -> services (business rules, transactions)
-> repositories (data access) -> models (ORM). Cross-layer imports must
only point downward in this list.
"""
