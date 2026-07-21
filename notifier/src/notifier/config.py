from pathlib import Path

from pydantic import BaseModel, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.config import RabbitMQConfig, RedisConfig

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = ROOT_DIR.parent / ".env"


class TelegramConfig(BaseModel):
    bot_token: SecretStr


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_PATH,
        env_file_encoding="utf-8",
        case_sensitive=False,
        env_nested_delimiter="__",
        env_prefix="APP_CONFIG__",
        extra="ignore",
    )

    rabbitmq: RabbitMQConfig
    redis: RedisConfig = RedisConfig()
    telegram: TelegramConfig


settings = Settings()
