from typing import Literal

from pydantic import BaseModel, SecretStr
from sqlalchemy import URL

from shared.config import BaseServiceSettings


class SQLAlchemyConfig(BaseModel):
    echo: bool = False
    echo_pool: bool = False
    pool_pre_ping: bool = True
    pool_size: int = 5
    max_overflow: int = 10

    naming_convention: dict[str, str] = {
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }


class DBConfig(BaseModel):
    name: str
    username: str
    password: SecretStr
    host: str
    port: int

    sqla: SQLAlchemyConfig = SQLAlchemyConfig()

    @property
    def async_url(self) -> URL:
        return URL.create(
            drivername="postgresql+asyncpg",
            username=self.username,
            password=self.password.get_secret_value(),
            host=self.host,
            port=self.port,
            database=self.name,
        )


class SMTPConfig(BaseModel):
    """Outbound mail.

    Locally this is Mailpit: no auth, no TLS, accepts anything. Production
    points at a real provider, which always requires both.
    """

    host: str = "127.0.0.1"
    port: int = 1025
    sender: str = "alerts@crypto-alerts.local"
    username: str = ""
    password: SecretStr = SecretStr("")
    # one field, not two booleans: starttls and implicit tls are mutually
    # exclusive, and a pair of flags would allow an impossible combination
    security: Literal["none", "starttls", "tls"] = "none"
    # a stuck SMTP connection holds a worker slot; the task retries anyway
    timeout: int = 15


class RunConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8080
    reload: bool = True
    public_url: str = "http://127.0.0.1:8080"  # base for links in emails
    # Peers allowed to set X-Forwarded-*: the reverse proxy in front of us.
    # Empty = no proxy (development). Headers from anyone else are ignored.
    trusted_proxies: list[str] = []
    # empty = any host (dev); production must pin its domain
    allowed_hosts: list[str] = []
    # browsers need this once the UI lives on another origin
    cors_origins: list[str] = []


class APIV1PrefixConfig(BaseModel):
    prefix: str = "/v1"
    users: str = "/users"
    auth: str = "/auth"
    alerts: str = "/alerts"
    prices: str = "/prices"


class APIPrefixConfig(BaseModel):
    prefix: str = "/api"
    login_path: str = "/login"
    v1: APIV1PrefixConfig = APIV1PrefixConfig()


class AuthConfig(BaseModel):
    secret_key: SecretStr
    algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    # rate limiting
    login_rate_limit: int = 5
    login_rate_window_seconds: int = 60
    register_rate_limit: int = 3
    register_rate_window_seconds: int = 300


class DemoConfig(BaseModel):
    """The published, shared demo account.

    Plain `str` rather than `SecretStr`, and pinned in the compose overlay
    rather than the secrets file: these credentials are printed in the README.
    Filing a published password as a secret would misdescribe it and drag it
    into `gen-secrets.sh`, which produces random values — the opposite of what
    a password quoted in documentation needs.

    Disabled by default so that no development or test database grows a demo
    user merely because the settings were imported.
    """

    enabled: bool = False
    username: str = "demo"
    email: str = "demo@example.com"
    password: str = "demo-password"


class Settings(BaseServiceSettings):
    run: RunConfig = RunConfig()
    api: APIPrefixConfig = APIPrefixConfig()
    db: DBConfig
    auth: AuthConfig
    smtp: SMTPConfig = SMTPConfig()
    demo: DemoConfig = DemoConfig()


settings = Settings()
