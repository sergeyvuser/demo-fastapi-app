import sys
from pathlib import Path

from loguru import logger
from pydantic import BaseModel
from pydantic_settings import BaseSettings

logger.add(
    sys.stderr, format="{time} {level} {message}", filter="my_module", level="INFO"
)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
logger.info(f"BASE_DIR Path: {BASE_DIR}")


class DBConfig(BaseModel):
    db_name: str = "granian"
    db_user: str = "root"
    db_password: str = ""
    db_url: str = ""


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
