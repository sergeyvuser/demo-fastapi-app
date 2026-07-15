"""Data access layer, one repository per aggregate.

Repositories flush(), never commit() — the transaction is owned by the
service layer. Ownership checks belong in the query itself (filter by
user_id), not in code after fetching.
"""
