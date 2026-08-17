from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

import aiosmtplib

from backend.core.config import settings


async def send_email(msg: EmailMessage) -> None:
    """The single place that knows how to reach the SMTP server.

    Locally that is Mailpit: no auth, no TLS. Production is a provider that
    requires both. These two call sites drifted apart once already.
    """

    msg["From"] = settings.smtp.sender
    # RFC 5322 requires Date; receivers read a missing Message-ID as a naive
    # sender. Both are transport concerns — identical for every message we send.
    # make_msgid() without a domain would stamp the container hostname into the
    # id, which is worse than not sending one.
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(
        domain=parseaddr(settings.smtp.sender)[1].rpartition("@")[2]
    )
    await aiosmtplib.send(
        msg,
        hostname=settings.smtp.host,
        port=settings.smtp.port,
        # empty strings would make aiosmtplib attempt AUTH against mailpit
        username=settings.smtp.username or None,
        password=settings.smtp.password.get_secret_value() or None,
        # explicit False rather than the library default None: with None
        # aiosmtplib negotiates STARTTLS on its own, and we want the configured
        # behaviour to be the actual behaviour
        start_tls=settings.smtp.security == "starttls",
        use_tls=settings.smtp.security == "tls",
        timeout=settings.smtp.timeout,
    )
