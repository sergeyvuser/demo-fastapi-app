from pathlib import Path

from pydantic import BaseModel, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> Path | None:
    """Locate .env by walking up from CWD.

    Works from the repo root and from any member directory (Makefile
    does `cd backend && uv run ...`). Returns None in containers, where
    there is no .env by design — config comes from the environment.
    """
    for directory in (Path.cwd(), *Path.cwd().parents):
        candidate = directory / ".env"
        if candidate.is_file():
            return candidate
    return None


class RabbitMQConfig(BaseModel):
    """Broker connection settings, shared by every service."""

    host: str = "127.0.0.1"
    port: int = 5672
    username: str = "rabbit"
    password: SecretStr

    @property
    def url(self) -> str:
        return f"amqp://{self.username}:{self.password.get_secret_value()}@{self.host}:{self.port}/"


class RedisConfig(BaseModel):
    """Connection policy for every service that talks to redis.

        Clients are built locally (shared must not depend on the redis package —
    ingestor would inherit it for nothing), but the numbers live here so they
    cannot drift between services, and so prod can tune them.
        Clients are always built with decode_responses=True — the code treats
    values as str everywhere (Decimal(raw), UUID(user_id), dedup keys). That
    is a contract, not a setting, so it is not a field here. Note the redis-py
    stubs still type responses as bytes|str, hence the casts at call sites.
    """

    host: str = "127.0.0.1"
    port: int = 6379
    db: int = 0
    connect_timeout: int = 3
    socket_timeout: int = 3

    @property
    def url(self) -> str:
        return f"redis://{self.host}:{self.port}/{self.db}"


class LogConfig(BaseModel):
    level: str = "INFO"
    json_format: bool = False  # human-readable locally, structured in containers


class OtelConfig(BaseModel):
    enabled: bool = True
    endpoint: str = "http://127.0.0.1:4317"
    sample_ratio: float = 1.0


class BaseServiceSettings(BaseSettings):
    """Common settings every service shares (env prefix, infra, observability)."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        env_nested_delimiter="__",
        env_prefix="APP_CONFIG__",
        extra="ignore",
    )

    redis: RedisConfig = RedisConfig()
    rabbitmq: RabbitMQConfig
    log: LogConfig = LogConfig()
    otel: OtelConfig = OtelConfig()
    testing: bool = False
