"""Deterministic environment for the whole test suite.

Every service validates its settings AT IMPORT time (`settings = Settings()`
at module level), so the environment must be ready before the first
`backend.*` import. pytest loads the root conftest before collecting test
modules — this is the earliest hook available.

Assignment is explicit, not `setdefault`: environment variables outrank the
dotenv file in pydantic-settings, so this also shields the run from whatever
sits in the developer's local .env. A test suite that passes only on the
machine that has the right .env is not a test suite.
"""

import os

os.environ.update(
    {
        "APP_CONFIG__DB__NAME": "test",
        "APP_CONFIG__DB__USERNAME": "test",
        "APP_CONFIG__DB__PASSWORD": "test",
        "APP_CONFIG__DB__HOST": "127.0.0.1",
        "APP_CONFIG__DB__PORT": "5432",
        "APP_CONFIG__DB__SQLA__ECHO": "false",
        "APP_CONFIG__AUTH__SECRET_KEY": "test-secret-key-not-for-production",
        "APP_CONFIG__RABBITMQ__PASSWORD": "test",
        # no exporter, no background export thread during tests
        "APP_CONFIG__OTEL__ENABLED": "false",
        "APP_CONFIG__LOG__LEVEL": "WARNING",
    }
)
