from pathlib import Path

from pydantic import BaseModel, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

from shared.config import RabbitMQConfig, RedisConfig

ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
ENV_PATH = ROOT_DIR.parent / ".env"


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
    host: str = "127.0.0.1"
    port: int = 1025
    sender: str = "alerts@crypto-alerts.local"


class RunConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8080
    reload: bool = True
    public_url: str = "http://127.0.0.1:8080"  # base for links in emails


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


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_PATH,
        env_file_encoding="utf-8",
        case_sensitive=False,
        env_nested_delimiter="__",
        env_prefix="APP_CONFIG__",
        extra="ignore",
    )
    run: RunConfig = RunConfig()
    api: APIPrefixConfig = APIPrefixConfig()
    db: DBConfig
    auth: AuthConfig
    redis: RedisConfig = RedisConfig()
    rabbitmq: RabbitMQConfig
    smtp: SMTPConfig = SMTPConfig()


settings = Settings()
