from pydantic import BaseModel

from shared.config import BaseServiceSettings


class StreamConfig(BaseModel):
    ws_url: str = "wss://stream.bybit.com/v5/public/spot"
    symbols: list[str] = ["BTCUSDT", "ETHUSDT"]
    reconnect_delay_seconds: float = 5.0


class Settings(BaseServiceSettings):
    stream: StreamConfig = StreamConfig()


settings = Settings()
