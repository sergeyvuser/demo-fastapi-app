"""Pydantic schemas — the HTTP boundary.

Naming: XxxCreate / XxxRead / XxxUpdate. XxxCreateInternal carries
service-side fields (hashed_password, user_id) and must never be
accepted from a request body. Read schemas set from_attributes and are
the only shape that leaves the API.
"""
