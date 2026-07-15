"""Application plumbing: settings, database engine, security primitives,
error types and handlers.

Kept import-light on purpose: import from concrete modules
(core.config, core.db, ...) — importing core.db creates the engine,
so nothing is re-exported from this package.
"""
