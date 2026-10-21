from shared.config import BaseServiceSettings, TelegramConfig


class Settings(BaseServiceSettings):
    telegram: TelegramConfig


settings = Settings()
