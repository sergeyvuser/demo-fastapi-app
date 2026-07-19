from pydantic import BaseModel, SecretStr


class RabbitMQConfig(BaseModel):
    """Broker connection settings, shared by every service."""

    host: str = "127.0.0.1"
    port: int = 5672
    username: str = "rabbit"
    password: SecretStr

    @property
    def url(self) -> str:
        return f"amqp://{self.username}:{self.password.get_secret_value()}@{self.host}:{self.port}/"
