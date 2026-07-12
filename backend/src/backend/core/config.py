from pathlib import Path

from loguru import logger
from pydantic import BaseModel, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
ENV_TEMPLATE_PATH = ROOT_DIR / ".env.template"
ENV_ACTUAL_PATH = ROOT_DIR / ".env"


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
        env_file=(ENV_TEMPLATE_PATH, ENV_ACTUAL_PATH),
        env_file_encoding="utf-8",
        case_sensitive=False,
        env_nested_delimiter="__",
        env_prefix="APP_CONFIG__",
        extra="ignore",
    )
    run: RunConfig = RunConfig()
    api: APIPrefixConfig = APIPrefixConfig()
    db: DBConfig
    pgadmin: PGAdminConfig


settings = Settings()
