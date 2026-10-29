from pydantic import BaseModel


class NotificationsRead(BaseModel):
    """Where this deployment's messages come from, as the Account screen says it.

    Facts of the deployment, not of the User: the bot a Linked chat must start,
    and the hour the Digest is sent.
    """

    # The bot's @username without the @. Null when Telegram did not answer
    # just now: the screen still renders, naming the bot is what waits.
    telegram_bot: str | None
    digest_hour_utc: int
