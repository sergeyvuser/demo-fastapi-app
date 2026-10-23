from datetime import datetime

from pydantic import BaseModel


class DemoRead(BaseModel):
    """The published demo account, as the Landing page needs it.

    These four fields and nothing more: this is a public, unauthenticated
    answer. The password is published on purpose (it is in the README too);
    anything added here is published with it.

    When the account is disabled the three details are null rather than
    absent or invented: the shape stays the same, and no client is handed
    credentials that open nothing.
    """

    enabled: bool
    email: str | None
    password: str | None
    resets_at: datetime | None
