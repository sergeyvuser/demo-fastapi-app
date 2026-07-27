from pydantic import BaseModel, SecretStr

from shared.config import BaseServiceSettings


class TelegramConfig(BaseModel):
    bot_token: SecretStr


class Settings(BaseServiceSettings):
    telegram: TelegramConfig


settings = Settings()
