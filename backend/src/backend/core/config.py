from pathlib import Path

from loguru import logger
from pydantic import BaseModel, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent


class DBConfig(BaseModel):
    name: str
    user: str
    password: str
    url: PostgresDsn
    host: str
    port: int
    echo: bool = False
    echo_pool: bool = False
    pool_pre_ping: bool = False
    pool_size: int = 50
    max_overflow: int = 10


class PGAdminConfig(BaseModel):
    email: str
    password: str


class RunConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8080
    reload: bool = True


class APIPrefixConfig(BaseModel):
    prefix: str = "/api"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.template", ".env"),
        case_sensitive=False,
        env_nested_delimiter="__",
        env_prefix="APP_CONFIG__",
    )
    run: RunConfig = RunConfig()
    api: APIPrefixConfig = APIPrefixConfig()
    db: DBConfig
    pgadmin: PGAdminConfig


settings = Settings()
