from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from shared.config import RabbitMQConfig

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = ROOT_DIR.parent / ".env"


class StreamConfig(BaseModel):
    ws_url: str = "wss://stream.bybit.com/v5/public/spot"
    symbols: list[str] = ["BTCUSDT", "ETHUSDT"]
    reconnect_delay_seconds: float = 5.0


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
    stream: StreamConfig = StreamConfig()


settings = Settings()
