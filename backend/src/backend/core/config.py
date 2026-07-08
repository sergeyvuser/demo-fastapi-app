from pathlib import Path

from loguru import logger
from pydantic import BaseModel
from pydantic_settings import BaseSettings

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
    pool_size: int = 50
    max_overflow: int = 10


class PGAdminConfig(BaseModel):
    email: str
    password: str


class RunConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8080
    reload: bool = False


class APIPrefixConfig(BaseModel):
    prefix: str = "/api/v1"


class Settings(BaseSettings):
    run: RunConfig = RunConfig()
    api: APIPrefixConfig = APIPrefixConfig()


settings = Settings()
