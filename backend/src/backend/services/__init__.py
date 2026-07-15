"""Business logic layer.

Services own transactions: exactly one commit at the end of each public
method. They raise AppError subclasses (core.exceptions) and know
nothing about HTTP.
"""
